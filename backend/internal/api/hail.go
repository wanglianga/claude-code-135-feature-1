package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// 冰雹减产分配：
//   POST /api/hail-allocations                平台/农场记录受灾照片、保险报案、可采果数量、补偿方案
//   GET  /api/hail-allocations[?project_id=]  分配方案列表
//   GET  /api/hail-allocations/{id}           方案详情（含每个认养人的选择）
//   POST /api/hail-allocations/{id}/choose    认养人三选一：延期 / 换品类 / 按比例退款
//   POST /api/hail-allocations/{id}/confirm   减产分配确认（证书换发 + ETA 更新 + 退款出账 + 续认信用）
//   POST /api/hail-choices/{id}/service       客服确认换品类（结果同步客服）
//   POST /api/hail-choices/{id}/batch         换品类认养人重新确认配送批次
//   GET  /api/farm/renew-credit               农场续认信用

func (s *Server) handleHailAllocations(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	ctx := r.Context()
	if r.Method == http.MethodGet {
		q := `SELECT ha.*, p.title AS project_title,
		             ic.status AS insurance_status, ic.amount AS insurance_amount
		      FROM hail_allocations ha
		      JOIN projects p ON p.id=ha.project_id
		      LEFT JOIN insurance_claims ic ON ic.id=ha.insurance_claim_id`
		args := []interface{}{}
		conds := []string{}
		if pid := r.URL.Query().Get("project_id"); pid != "" {
			conds = append(conds, fmt.Sprintf("ha.project_id=$%d", len(args)+1))
			args = append(args, pid)
		}
		if u.Role == "adopter" {
			conds = append(conds, fmt.Sprintf(
				"EXISTS(SELECT 1 FROM adoptions a WHERE a.project_id=ha.project_id AND a.user_id=$%d)",
				len(args)+1))
			args = append(args, u.ID)
		} else if u.FarmID != nil && u.Role != "admin" && u.Role != "service" {
			conds = append(conds, fmt.Sprintf("p.farm_id=$%d", len(args)+1))
			args = append(args, *u.FarmID)
		}
		if len(conds) > 0 {
			q += " WHERE " + strings.Join(conds, " AND ")
		}
		q += " ORDER BY ha.id DESC"
		rows, err := s.queryRows(ctx, q, args...)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, rows)
		return
	}
	if r.Method != http.MethodPost {
		writeErr(w, 405, "方法不允许")
		return
	}
	if !requireRole(u, "farmer", "admin", "service") {
		writeErr(w, 403, "只有农场/平台/客服可以发布减产分配方案")
		return
	}
	var in map[string]interface{}
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	pid, _ := i64(in, "project_id")
	title, _ := str(in, "title")
	pickable, hasPick := f64(in, "pickable_kg")
	if pid == 0 || title == "" || !hasPick {
		writeErr(w, 400, "project_id/title/pickable_kg 必填")
		return
	}
	var farmID int64
	var batchNo string
	err := s.Pool.QueryRow(ctx, `SELECT farm_id, batch_no FROM projects WHERE id=$1`, pid).Scan(&farmID, &batchNo)
	if err != nil {
		writeErr(w, 404, "认养项目不存在")
		return
	}
	if u.Role == "farmer" && (u.FarmID == nil || *u.FarmID != farmID) {
		writeErr(w, 403, "不能为其他农场发布方案")
		return
	}
	// 适用订单（空=本批次全部认养订单）
	targetIDs := []int64{}
	if raw, ok := in["target_adoption_ids"].([]interface{}); ok {
		for _, v := range raw {
			if id, ok := asID(v); ok {
				targetIDs = append(targetIDs, id)
			}
		}
	}
	if len(targetIDs) > 0 {
		var valid int
		_ = s.Pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM adoptions WHERE project_id=$1 AND id = ANY($2)`,
			pid, targetIDs).Scan(&valid)
		if valid != len(targetIDs) {
			writeErr(w, 400, "target_adoption_ids 含不属于本项目的订单")
			return
		}
	}
	// 承诺总量：适用订单（默认全部已售订单）的 份额×保底
	var committed float64
	if len(targetIDs) > 0 {
		_ = s.Pool.QueryRow(ctx,
			`SELECT COALESCE(SUM(a.shares*p.guarantee_kg),0)
			 FROM adoptions a JOIN projects p ON p.id=a.project_id
			 WHERE a.project_id=$1 AND a.id = ANY($2)`, pid, targetIDs).Scan(&committed)
	} else {
		_ = s.Pool.QueryRow(ctx,
			`SELECT COALESCE(SUM(a.shares*p.guarantee_kg),0)
			 FROM adoptions a JOIN projects p ON p.id=a.project_id WHERE a.project_id=$1`, pid).Scan(&committed)
	}
	if v, ok := f64(in, "committed_kg"); ok && v > 0 {
		committed = v
	}
	photos := in["photos"]
	if photos == nil {
		photos = []interface{}{}
	}
	delayOpt := in["delay_option"]
	if delayOpt == nil {
		delayOpt = map[string]interface{}{}
	}
	switchOpt := in["switch_option"]
	if switchOpt == nil {
		switchOpt = []interface{}{}
	}
	refundPct, _ := f64(in, "refund_pct")
	// 默认退款比例 = 缺口 / 承诺量 × 100
	if refundPct == 0 && committed > 0 && pickable < committed {
		refundPct = roundF((committed-pickable)/committed*100, 2)
	}
	var incID interface{}
	if v, ok := i64(in, "incident_id"); ok && v > 0 {
		incID = v
	} else {
		_ = s.Pool.QueryRow(ctx,
			`SELECT id FROM incidents WHERE project_id=$1 AND kind='hail' ORDER BY id LIMIT 1`, pid).Scan(&incID)
	}
	var claimID interface{}
	if v, ok := i64(in, "insurance_claim_id"); ok && v > 0 {
		claimID = v
	} else {
		_ = s.Pool.QueryRow(ctx,
			`SELECT id FROM insurance_claims WHERE project_id=$1 ORDER BY id DESC LIMIT 1`, pid).Scan(&claimID)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var aid int64
	err = tx.QueryRow(ctx, `
		INSERT INTO hail_allocations(project_id, batch_no, incident_id, insurance_claim_id, title, photos,
			pickable_kg, committed_kg, delay_option, switch_option, refund_pct, compensation_plan,
			target_adoption_ids, created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
		pid, batchNo, incID, claimID, title, jsonText(photos), pickable, committed,
		jsonText(delayOpt), jsonText(switchOpt), refundPct, asString(in["compensation_plan"]),
		jsonText(targetIDs), u.ID).Scan(&aid)
	if err != nil {
		writeErr(w, 400, "创建失败："+err.Error())
		return
	}
	if incID != nil {
		if iid, ok := incID.(int64); ok {
			_, _ = tx.Exec(ctx, `
				INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
				VALUES($1,$2,$3,'记录冰雹减产分配方案',$4)`,
				iid, u.ID, roleOr(u, "service"),
				fmt.Sprintf("平台已记录受灾照片、保险报案与可采果数量 %.1fkg（承诺 %.1fkg），补偿方案：%s",
					pickable, committed, asString(in["compensation_plan"])))
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_allocations WHERE id=$1`, aid)
	writeJSON(w, 201, row)
}

func (s *Server) handleHailAllocationByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/hail-allocations/"), "/")
	parts := strings.Split(rest, "/")
	id, err := parseID(parts[0])
	if err != nil {
		writeErr(w, 404, "分配方案不存在")
		return
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	if action != "" && action != "choose" && action != "confirm" {
		writeErr(w, 404, "未知操作")
		return
	}
	u := s.currentUser(r)
	ctx := r.Context()

	al, err := s.queryOne(ctx, `
		SELECT ha.*, p.title AS project_title, p.farm_id,
		       ic.status AS insurance_status, ic.amount AS insurance_amount
		FROM hail_allocations ha JOIN projects p ON p.id=ha.project_id
		LEFT JOIN insurance_claims ic ON ic.id=ha.insurance_claim_id
		WHERE ha.id=$1`, id)
	if err != nil {
		writeErr(w, 404, "分配方案不存在")
		return
	}
	choices, _ := s.queryRows(ctx, `
		SELECT hc.*, a.recipient_name, a.phone, a.shares, a.amount AS adoption_amount,
		       us.name AS user_name, sv.name AS service_name
		FROM hail_choices hc
		JOIN adoptions a ON a.id=hc.adoption_id
		JOIN users us ON us.id=hc.user_id
		LEFT JOIN users sv ON sv.id=hc.service_by
		WHERE hc.allocation_id=$1 ORDER BY hc.id`, id)
	if choices == nil {
		choices = []map[string]interface{}{}
	}

	// 访问权限
	pid, _ := asID(al["project_id"])
	farmIDv, _ := asID(al["farm_id"])
	if r.Method == http.MethodGet {
		if u.Role == "adopter" {
			var n int
			_ = s.Pool.QueryRow(ctx,
				`SELECT COUNT(*) FROM adoptions WHERE project_id=$1 AND user_id=$2`, pid, u.ID).Scan(&n)
			if n == 0 {
				writeErr(w, 403, "只能查看本人认养项目的分配方案")
				return
			}
		} else if u.FarmID != nil && u.Role != "admin" && u.Role != "service" && *u.FarmID != farmIDv {
			writeErr(w, 403, "只能查看本农场的分配方案")
			return
		}
		writeJSON(w, 200, map[string]interface{}{
			"allocation":   al,
			"choices":      choices,
			"renew_credit": s.farmCredit(ctx, farmIDv),
		})
		return
	}

	if r.Method != http.MethodPost {
		writeErr(w, 405, "方法不允许")
		return
	}
	switch action {
	case "choose":
		s.hailChoose(w, r, id, al)
	case "confirm":
		s.hailConfirm(w, r, id, al, choices)
	default:
		writeErr(w, 404, "未知操作")
	}
}

// hailChoose 认养人选择 延期 / 换品类 / 按比例退款
func (s *Server) hailChoose(w http.ResponseWriter, r *http.Request, allocID int64, al map[string]interface{}) {
	u := s.currentUser(r)
	if u.Role != "adopter" && u.Role != "admin" {
		writeErr(w, 403, "只有认养人本人可以选择减产分配方式")
		return
	}
	var in map[string]interface{}
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	adoptionID, _ := i64(in, "adoption_id")
	opt, _ := str(in, "option")
	if adoptionID == 0 || !map[string]bool{"delay": true, "switch": true, "refund": true}[opt] {
		writeErr(w, 400, "adoption_id 与 option(delay/switch/refund) 必填")
		return
	}
	if st, _ := al["status"].(string); st == "confirmed" || st == "closed" {
		writeErr(w, 409, "分配方案已确认，不能再修改选择")
		return
	}
	ctx := r.Context()
	var ownerID, projectID int64
	var orderAmount float64
	err := s.Pool.QueryRow(ctx, `SELECT user_id, project_id, amount FROM adoptions WHERE id=$1`, adoptionID).
		Scan(&ownerID, &projectID, &orderAmount)
	if err != nil {
		writeErr(w, 404, "认养订单不存在")
		return
	}
	apid, _ := asID(al["project_id"])
	if projectID != apid {
		writeErr(w, 400, "订单不属于该认养项目")
		return
	}
	// 方案限定了适用订单时，非适用订单不能选择
	if targets, ok := al["target_adoption_ids"].([]interface{}); ok && len(targets) > 0 {
		found := false
		for _, v := range targets {
			if id, ok := asID(v); ok && id == adoptionID {
				found = true
				break
			}
		}
		if !found {
			writeErr(w, 400, "该订单不在此减产分配方案的适用范围内")
			return
		}
	}
	if u.Role == "adopter" && ownerID != u.ID {
		writeErr(w, 403, "只能为本人订单选择")
		return
	}

	var eta, switchKind, switchTitle string
	var switchKg, refundAmount, refundPct float64
	serviceStatus, batchStatus := "n/a", "n/a"
	switch opt {
	case "delay":
		if dm, ok := al["delay_option"].(map[string]interface{}); ok {
			eta, _ = dm["eta_date"].(string)
		}
		if v, ok := str(in, "eta_date"); ok {
			eta = v
		}
		if eta == "" {
			writeErr(w, 400, "延期方案缺少预计到货日期")
			return
		}
	case "switch":
		switchKind, _ = str(in, "switch_kind")
		switchTitle, _ = str(in, "switch_title")
		if switchTitle == "" {
			writeErr(w, 400, "换品类必须选择替代品类")
			return
		}
		switchKg, _ = f64(in, "switch_kg")
		eta, _ = str(in, "eta_date")
		serviceStatus, batchStatus = "pending", "pending"
	case "refund":
		refundPct, _ = f64(in, "refund_pct")
		if refundPct == 0 {
			refundPct, _ = numVal(al["refund_pct"])
		}
		if refundPct <= 0 || refundPct > 100 {
			writeErr(w, 400, "退款比例非法")
			return
		}
		refundAmount = roundF(orderAmount*refundPct/100, 2)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var cid int64
	err = tx.QueryRow(ctx, `
		INSERT INTO hail_choices(allocation_id, adoption_id, user_id, option, refund_pct, refund_amount,
			switch_kind, switch_title, switch_kg, eta_date, note, service_status, batch_status)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (allocation_id, adoption_id) DO UPDATE SET
			option=EXCLUDED.option, refund_pct=EXCLUDED.refund_pct, refund_amount=EXCLUDED.refund_amount,
			switch_kind=EXCLUDED.switch_kind, switch_title=EXCLUDED.switch_title, switch_kg=EXCLUDED.switch_kg,
			eta_date=EXCLUDED.eta_date, note=EXCLUDED.note,
			service_status=EXCLUDED.service_status, batch_status=EXCLUDED.batch_status,
			service_by=NULL, service_at=NULL, service_note='',
			batch_by=NULL, batch_at=NULL, batch_plan='{}'::jsonb,
			status='chosen', confirmed_at=NULL
		RETURNING id`,
		allocID, adoptionID, ownerID, opt, refundPct, refundAmount,
		switchKind, switchTitle, nullableF64(switchKg), nullableStr(eta), asString(in["note"]),
		serviceStatus, batchStatus).Scan(&cid)
	if err != nil {
		writeErr(w, 400, "提交失败："+err.Error())
		return
	}
	_, _ = tx.Exec(ctx, `UPDATE hail_allocations SET status='confirming' WHERE id=$1 AND status='open'`, allocID)
	if incID, ok := asID(al["incident_id"]); ok {
		actionText := map[string]string{
			"delay":  "认养人选择延期交付",
			"switch": "认养人选择换品类",
			"refund": "认养人选择按比例退款",
		}[opt]
		note := asString(in["note"])
		switch opt {
		case "delay":
			note = fmt.Sprintf("预计到货更新为 %s。%s", eta, note)
		case "switch":
			note = fmt.Sprintf("换为「%s」（约 %.1fkg，预计 %s 到货），等待客服确认。%s", switchTitle, switchKg, eta, note)
		case "refund":
			note = fmt.Sprintf("按比例退款 %.0f%%，应退 ¥%.2f。%s", refundPct, refundAmount, note)
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,'adopter',$3,$4)`, incID, ownerID, actionText, note)
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_choices WHERE id=$1`, cid)
	writeJSON(w, 201, row)
}

// hailConfirm 减产分配确认：证书换发、ETA 更新、退款出账、续认信用同步
func (s *Server) hailConfirm(w http.ResponseWriter, r *http.Request, allocID int64, al map[string]interface{}, choices []map[string]interface{}) {
	u := s.currentUser(r)
	if !requireRole(u, "farmer", "admin", "service") {
		writeErr(w, 403, "只有农场/平台/客服可以确认分配方案")
		return
	}
	if st, _ := al["status"].(string); st == "confirmed" || st == "closed" {
		writeErr(w, 409, "分配方案已确认")
		return
	}
	pid, _ := asID(al["project_id"])
	farmID, _ := asID(al["farm_id"])
	batchNo, _ := al["batch_no"].(string)
	incID, _ := asID(al["incident_id"])
	if u.Role == "farmer" && (u.FarmID == nil || *u.FarmID != farmID) {
		writeErr(w, 403, "只能确认本农场的方案")
		return
	}
	ctx := r.Context()

	// 适用订单都必须已选择；换品类必须客服确认 + 批次重确认
	targetIDs := []int64{}
	if raw, ok := al["target_adoption_ids"].([]interface{}); ok {
		for _, v := range raw {
			if id, ok := asID(v); ok {
				targetIDs = append(targetIDs, id)
			}
		}
	}
	totalAdoptions := len(targetIDs)
	if totalAdoptions == 0 {
		_ = s.Pool.QueryRow(ctx, `SELECT COUNT(*) FROM adoptions WHERE project_id=$1`, pid).Scan(&totalAdoptions)
	}
	if len(choices) < totalAdoptions {
		writeErr(w, 409, fmt.Sprintf("尚有 %d 笔订单未作出选择，不能确认", totalAdoptions-len(choices)))
		return
	}
	for _, c := range choices {
		opt, _ := c["option"].(string)
		if opt == "switch" {
			if c["service_status"] != "confirmed" {
				writeErr(w, 409, "存在换品类选择未经客服确认")
				return
			}
			if c["batch_status"] != "confirmed" {
				writeErr(w, 409, "存在换品类选择未重新确认配送批次")
				return
			}
		}
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	// 方案未关联冰雹工单时，确认时自动补建，保证退款能挂到工单赔付与流水
	if incID == 0 {
		allocTitle, _ := al["title"].(string)
		_ = tx.QueryRow(ctx, `
			INSERT INTO incidents(project_id, batch_no, adoption_id, kind, title, description, reporter_id, status, resolved_at)
			VALUES($1,$2,NULL,'hail',$3,'冰雹减产分配确认时自动补建工单',$4,'resolved',now())
			RETURNING id`,
			pid, batchNo, allocTitle, u.ID).Scan(&incID)
		// 回填方案与工单的关联
		_, _ = tx.Exec(ctx, `UPDATE hail_allocations SET incident_id=$1 WHERE id=$2`, incID, allocID)
	}

	var delayShares, switchShares, refundShares int64
	for _, c := range choices {
		cid, _ := asID(c["id"])
		aid, _ := asID(c["adoption_id"])
		opt, _ := c["option"].(string)
		shares := int64(0)
		if v, ok := numVal(c["shares"]); ok {
			shares = int64(v)
		}
		eta := dateVal(c["eta_date"])
		var certNote string
		switch opt {
		case "delay":
			delayShares += shares
			certNote = fmt.Sprintf("冰雹减产分配：选择延期交付，预计到货时间更新为 %s。", eta)
		case "switch":
			switchShares += shares
			st, _ := c["switch_title"].(string)
			certNote = fmt.Sprintf("冰雹减产分配：换为「%s」，配送批次已重新确认（预计 %s 到货）。", st, eta)
		case "refund":
			refundShares += shares
			amt, _ := numVal(c["refund_amount"])
			pct, _ := numVal(c["refund_pct"])
			certNote = fmt.Sprintf("冰雹减产分配：按比例退款 %.0f%%（¥%.2f 已原路退回）。", pct, amt)
			// 退款出账（幂等：同一工单+订单已有现金赔付则跳过）
			if incID > 0 {
				var existed int
				_ = tx.QueryRow(ctx,
					`SELECT COUNT(*) FROM compensations WHERE incident_id=$1 AND adoption_id=$2 AND kind='cash'`,
					incID, aid).Scan(&existed)
				if existed == 0 {
					_, _ = tx.Exec(ctx, `
						INSERT INTO compensations(incident_id, adoption_id, project_id, amount, kind, status, note, paid_at)
						VALUES($1,$2,$3,$4,'cash','paid',$5,now())`,
						incID, aid, pid, amt,
						fmt.Sprintf("冰雹减产按比例退款 %.0f%%，原路退回", pct))
				}
			}
		}
		if eta != "" {
			_, _ = tx.Exec(ctx, `UPDATE adoptions SET eta_date=$1 WHERE id=$2`, eta, aid)
		}
		// 认养证书换发新版本
		var certAid int64
		errCert := tx.QueryRow(ctx, `SELECT id FROM certificates WHERE adoption_id=$1`, aid).Scan(&certAid)
		if errCert != nil {
			certNo := fmt.Sprintf("CERT-%s-%04d", batchNo, aid)
			_, _ = tx.Exec(ctx, `
				INSERT INTO certificates(adoption_id, cert_no, version, reissue_note, updated_at)
				VALUES($1,$2,1,$3,now())`, aid, certNo, certNote)
		} else {
			_, _ = tx.Exec(ctx, `
				UPDATE certificates SET version=version+1, reissue_note=$1, updated_at=now() WHERE id=$2`,
				certNote, certAid)
		}
		_, _ = tx.Exec(ctx,
			`UPDATE hail_choices SET status='confirmed', confirmed_at=now() WHERE id=$1`, cid)
	}

	_, _ = tx.Exec(ctx, `UPDATE hail_allocations SET status='confirmed', confirmed_at=now() WHERE id=$1`, allocID)

	// 农场续认信用：以 100 为基准，累计当季全部冰雹处置：
	// 每次处置 +2，每份延期/换品类 +1，每份退款 -2，区间 [0,120]
	var prevDelay, prevSwitch, prevRefund, prevHandled int64
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(delayed_shares,0), COALESCE(switched_shares,0),
		       COALESCE(refunded_shares,0), COALESCE(hail_handled,0)
		FROM farm_renew_credit WHERE farm_id=$1 AND season='2026' FOR UPDATE`,
		farmID).Scan(&prevDelay, &prevSwitch, &prevRefund, &prevHandled)
	totalDelay := prevDelay + delayShares
	totalSwitch := prevSwitch + switchShares
	totalRefund := prevRefund + refundShares
	totalHandled := prevHandled + 1
	score := 100 + 2*float64(totalHandled) + float64(totalDelay) + float64(totalSwitch) - 2*float64(totalRefund)
	if score < 0 {
		score = 0
	}
	if score > 120 {
		score = 120
	}
	level := "D"
	switch {
	case score >= 110:
		level = "A"
	case score >= 90:
		level = "B"
	case score >= 70:
		level = "C"
	}
	delta := score - 100
	creditNote := fmt.Sprintf("冰雹减产分配：本次延期 %d 份、换品类 %d 份、退款 %d 份；当季累计处置 %d 次，信用变化 %+.0f 分。",
		delayShares, switchShares, refundShares, totalHandled, delta)
	_, _ = tx.Exec(ctx, `
		INSERT INTO farm_renew_credit(farm_id, project_id, season, score, level, hail_handled,
			delayed_shares, switched_shares, refunded_shares, delta, note, updated_at)
		VALUES($1,$2,'2026',$3,$4,$5,$6,$7,$8,$9,$10,now())
		ON CONFLICT (farm_id, season) DO UPDATE SET
			project_id=EXCLUDED.project_id, score=EXCLUDED.score, level=EXCLUDED.level,
			hail_handled=EXCLUDED.hail_handled,
			delayed_shares=EXCLUDED.delayed_shares,
			switched_shares=EXCLUDED.switched_shares, refunded_shares=EXCLUDED.refunded_shares,
			delta=EXCLUDED.delta, note=EXCLUDED.note, updated_at=now()`,
		farmID, pid, score, level, totalHandled, totalDelay, totalSwitch, totalRefund, delta, creditNote)

	if incID > 0 {
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,$3,'减产分配已确认',$4)`,
			incID, u.ID, roleOr(u, "farmer"),
			fmt.Sprintf("认养证书已换发新版本、预计到货时间已更新；%s 当前续认信用 %.0f 分（%s 级）。",
				creditNote, score, level))
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_allocations WHERE id=$1`, allocID)
	credit := s.farmCredit(ctx, farmID)
	writeJSON(w, 200, map[string]interface{}{
		"allocation":   row,
		"renew_credit": credit,
		"summary":      creditNote,
	})
}

// handleHailChoices /api/hail-choices/{id}/service | /batch
func (s *Server) handleHailChoices(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/hail-choices/"), "/")
	parts := strings.Split(rest, "/")
	id, err := parseID(parts[0])
	if err != nil || (r.Method != http.MethodPost) {
		writeErr(w, 404, "选择记录不存在")
		return
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	ctx := r.Context()
	ch, err := s.queryOne(ctx, `
		SELECT hc.*, ha.project_id, ha.incident_id, ha.batch_no, p.farm_id
		FROM hail_choices hc JOIN hail_allocations ha ON ha.id=hc.allocation_id
		JOIN projects p ON p.id=ha.project_id WHERE hc.id=$1`, id)
	if err != nil {
		writeErr(w, 404, "选择记录不存在")
		return
	}
	var in map[string]interface{}
	_ = decode(r, &in)

	if action == "service" {
		// 客服确认换品类
		if !requireRole(u, "service", "admin") {
			writeErr(w, 403, "只有客服可以确认换品类")
			return
		}
		if ch["option"] != "switch" {
			writeErr(w, 400, "仅换品类选择需要客服确认")
			return
		}
		status, _ := str(in, "status")
		if status == "" {
			status = "confirmed"
		}
		if status != "confirmed" && status != "rejected" {
			writeErr(w, 400, "状态只能是 confirmed/rejected")
			return
		}
		note := asString(in["service_note"])
		if note == "" {
			note = asString(in["note"])
		}
		tx, e := s.Pool.Begin(ctx)
		if e != nil {
			writeErr(w, 500, e.Error())
			return
		}
		defer tx.Rollback(ctx)
		_, e = tx.Exec(ctx,
			`UPDATE hail_choices SET service_status=$1, service_by=$2, service_at=now(), service_note=$3 WHERE id=$4`,
			status, u.ID, note, id)
		if e != nil {
			writeErr(w, 500, e.Error())
			return
		}
		// 拒绝后允许认养人重新选择；确认后等待认养人重新确认配送批次
		if status == "rejected" {
			_, _ = tx.Exec(ctx, `UPDATE hail_choices SET batch_status='n/a' WHERE id=$1`, id)
		}
		if incID, ok := asID(ch["incident_id"]); ok {
			txt := "客服已确认换品类，换品类结果同步客服工单组与冷链调度。"
			if status == "rejected" {
				txt = "客服驳回换品类申请：" + note + "，请认养人重新选择。"
			}
			_, _ = tx.Exec(ctx, `
				INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
				VALUES($1,$2,'service',$3,$4)`,
				incID, u.ID, "客服确认换品类", txt)
		}
		if err := tx.Commit(ctx); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		row, _ := s.queryOne(ctx, `SELECT * FROM hail_choices WHERE id=$1`, id)
		writeJSON(w, 200, row)
		return
	}

	if action == "batch" {
		// 换品类认养人重新确认配送批次
		var ownerID int64
		_ = s.Pool.QueryRow(ctx, `SELECT user_id FROM hail_choices WHERE id=$1`, id).Scan(&ownerID)
		if u.Role != "admin" && u.ID != ownerID {
			writeErr(w, 403, "只能由认养人本人重新确认配送批次")
			return
		}
		if ch["option"] != "switch" {
			writeErr(w, 400, "仅换品类选择需要重新确认配送批次")
			return
		}
		if ch["service_status"] != "confirmed" {
			writeErr(w, 409, "客服尚未确认换品类，暂不能确认配送批次")
			return
		}
		if ch["batch_status"] == "confirmed" {
			writeErr(w, 409, "配送批次已确认")
			return
		}
		plan := in["batch_plan"]
		if plan == nil {
			writeErr(w, 400, "batch_plan 必填（seq/plan_date/pack_spec/cold_route）")
			return
		}
		planMap, ok := plan.(map[string]interface{})
		if !ok {
			writeErr(w, 400, "batch_plan 格式错误")
			return
		}
		projectID, _ := asID(ch["project_id"])
		adoptionID, _ := asID(ch["adoption_id"])
		batchNo, _ := ch["batch_no"].(string)
		// 落一笔换品类后的计划发货批次
		seq, _ := f64(planMap, "seq")
		if seq == 0 {
			_ = s.Pool.QueryRow(ctx,
				`SELECT COALESCE(MAX(seq),0)+1 FROM shipments WHERE adoption_id=$1`, adoptionID).Scan(&seq)
		}
		planDate, _ := planMap["plan_date"].(string)
		packSpec, _ := planMap["pack_spec"].(string)
		coldRoute, _ := planMap["cold_route"].(string)
		weight, _ := f64(planMap, "weight_kg")
		var shipID int64
		err = s.Pool.QueryRow(ctx, `
			INSERT INTO shipments(project_id, adoption_id, batch_no, seq, plan_date, pack_spec, cold_route, weight_kg, status)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned') RETURNING id`,
			projectID, adoptionID, batchNo, int64(seq), nullableStr(planDate), packSpec, coldRoute,
			nullableF64(weight)).Scan(&shipID)
		if err != nil {
			writeErr(w, 400, "创建配送批次失败："+err.Error())
			return
		}
		planMap["shipment_id"] = shipID
		if planDate != "" {
			_, _ = s.Pool.Exec(ctx, `UPDATE adoptions SET eta_date=$1 WHERE id=$2`, planDate, adoptionID)
		}
		_, err = s.Pool.Exec(ctx, `
			UPDATE hail_choices SET batch_status='confirmed', batch_plan=$1, batch_by=$2, batch_at=now(),
			                       eta_date=COALESCE(NULLIF($3,'')::date,eta_date)
			WHERE id=$4`, jsonText(planMap), u.ID, planDate, id)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if incID, ok := asID(ch["incident_id"]); ok {
			_, _ = s.Pool.Exec(ctx, `
				INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
				VALUES($1,$2,'adopter','重新确认换品类配送批次',$3)`,
				incID, u.ID,
				fmt.Sprintf("第 %.0f 批 %s 发出，%s，%s。", seq, planDate, packSpec, coldRoute))
		}
		row, _ := s.queryOne(ctx, `SELECT * FROM hail_choices WHERE id=$1`, id)
		writeJSON(w, 200, row)
		return
	}
	writeErr(w, 404, "未知操作")
}

// handleRenewCredit 农场续认信用
func (s *Server) handleRenewCredit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "方法不允许")
		return
	}
	u := s.currentUser(r)
	farmID := int64(0)
	if u.FarmID != nil {
		farmID = *u.FarmID
	}
	if v := r.URL.Query().Get("farm_id"); v != "" && (u.Role == "admin" || u.Role == "service") {
		fmt.Sscanf(v, "%d", &farmID)
	}
	if farmID == 0 && u.Role != "admin" && u.Role != "service" {
		writeErr(w, 400, "当前账号未关联农场")
		return
	}
	rows, err := s.queryRows(r.Context(), `
		SELECT frc.*, f.name AS farm_name FROM farm_renew_credit frc
		JOIN farms f ON f.id=frc.farm_id
		WHERE ($1=0 OR frc.farm_id=$1) ORDER BY frc.season DESC, frc.id DESC`, farmID)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, rows)
}

// farmCredit 取农场当季续认信用（无记录返回 nil）
func (s *Server) farmCredit(ctx context.Context, farmID int64) map[string]interface{} {
	row, err := s.queryOne(ctx, `
		SELECT frc.*, f.name AS farm_name FROM farm_renew_credit frc
		JOIN farms f ON f.id=frc.farm_id
		WHERE frc.farm_id=$1 ORDER BY frc.season DESC LIMIT 1`, farmID)
	if err != nil {
		return nil
	}
	return row
}

// jsonText 把任意值序列化为 JSON 字符串（写 JSONB 列，simple/binary 协议均可）
func jsonText(v interface{}) string {
	if v == nil {
		return "null"
	}
	if s, ok := v.(string); ok {
		return s
	}
	b, err := json.Marshal(v)
	if err != nil {
		return "null"
	}
	return string(b)
}

// ---------- 小工具 ----------

// dateVal 从查询结果取 YYYY-MM-DD（DATE 列在 pgx 下可能是 time.Time）
func dateVal(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case time.Time:
		return x.Format("2006-01-02")
	}
	return ""
}

func nullableStr(v string) interface{} {
	if v == "" {
		return nil
	}
	return v
}

func roleOr(u *User, fallback string) string {
	if u == nil {
		return fallback
	}
	return u.Role
}
