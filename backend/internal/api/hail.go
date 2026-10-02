package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"
)

// 冰雹减产分配
// 平台/农场登记：受灾照片、保险报案、可采果数量、三选一补偿方案；
// 认养人选择：延期(delay) / 换品类(swap) / 按比例退款(refund)；
// 确认后换发认养证书、更新预计到货时间、同步农场续认信用；
// 换品类需客服确认，认养人再确认配送批次；理赔状态同步认养人。

var certSuffixRe = regexp.MustCompile(`-R\d+$`)

func nullableDate(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func claimLabel(id int64) string {
	if id == 0 {
		return "处理中"
	}
	return fmt.Sprintf("已关联报案 #%d", id)
}

func farmIDOfProject(ctx context.Context, s *Server, pid int64) int64 {
	var farmID int64
	_ = s.Pool.QueryRow(ctx, `SELECT farm_id FROM projects WHERE id=$1`, pid).Scan(&farmID)
	return farmID
}

// reissueCertificate 换发认养证书。已有证书：版本号 +1、编号追加 -R{version}；
// 尚无证书（历史订单）：补签普通第 1 版证书。
func (s *Server) reissueCertificate(ctx context.Context, executor queryExec, adoptionID int64, reason string) (string, int, error) {
	var certNo, batchNo string
	var version int
	existed := true
	err := executor.QueryRow(ctx, `
		SELECT c.cert_no, c.version, a.batch_no
		FROM certificates c JOIN adoptions a ON a.id=c.adoption_id
		WHERE c.adoption_id=$1`, adoptionID).Scan(&certNo, &version, &batchNo)
	if err != nil {
		existed = false
		_ = s.Pool.QueryRow(ctx, `SELECT batch_no FROM adoptions WHERE id=$1`, adoptionID).Scan(&batchNo)
		certNo = fmt.Sprintf("CERT-%s-%04d", batchNo, adoptionID)
		version = 0
	}
	var newCertNo string
	var newVersion int
	if existed {
		newVersion = version + 1
		newCertNo = fmt.Sprintf("%s-R%d", certSuffixRe.ReplaceAllString(certNo, ""), newVersion)
	} else {
		newVersion = 1
		newCertNo = certNo
	}
	_, err = executor.Exec(ctx, `
		INSERT INTO certificates(adoption_id, cert_no, version, reissue_reason, reissued_at)
		VALUES($1,$2,$3,$4,now())
		ON CONFLICT (adoption_id) DO UPDATE SET
			cert_no=EXCLUDED.cert_no, version=EXCLUDED.version,
			reissue_reason=EXCLUDED.reissue_reason, reissued_at=EXCLUDED.reissued_at`,
		adoptionID, newCertNo, newVersion, reason)
	if err != nil {
		return "", 0, err
	}
	return newCertNo, newVersion, nil
}

// queryExec 抽象 pgxpool.Pool 与 pgx.Tx 的查询能力
type queryExec interface {
	QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row
	Exec(ctx context.Context, sql string, args ...interface{}) (pgconn.CommandTag, error)
}

// ---------- 分配单：列表 / 登记 ----------

func (s *Server) handleHailAllocations(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	ctx := r.Context()
	if r.Method == http.MethodGet {
		q := `SELECT ha.*, p.title AS project_title, p.farm_id,
		              (SELECT ic.status FROM insurance_claims ic WHERE ic.id=ha.insurance_claim_id) AS insurance_status,
		              (SELECT count(*) FROM hail_choices hc WHERE hc.allocation_id=ha.id) AS choice_count,
		              (SELECT count(*) FROM hail_choices hc WHERE hc.allocation_id=ha.id AND hc.status='confirmed') AS confirmed_count
		       FROM hail_allocations ha JOIN projects p ON p.id=ha.project_id`
		args := []interface{}{}
		conds := []string{}
		if pid := r.URL.Query().Get("project_id"); pid != "" {
			conds = append(conds, fmt.Sprintf("ha.project_id=$%d", len(args)+1))
			args = append(args, pid)
		}
		if iid := r.URL.Query().Get("incident_id"); iid != "" {
			conds = append(conds, fmt.Sprintf("ha.incident_id=$%d", len(args)+1))
			args = append(args, iid)
		}
		if u.Role == "adopter" {
			conds = append(conds, fmt.Sprintf(
				"ha.id IN (SELECT allocation_id FROM hail_choices WHERE user_id=$%d)", len(args)+1))
			args = append(args, u.ID)
		} else if u.Role != "admin" && u.Role != "service" && u.FarmID != nil {
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
	if !requireRole(u, "farmer", "admin") {
		writeErr(w, 403, "只有农场方可以登记冰雹减产分配")
		return
	}
	var in map[string]interface{}
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	incidentID, _ := i64(in, "incident_id")
	if incidentID == 0 {
		writeErr(w, 400, "incident_id 必填（冰雹工单）")
		return
	}
	pickable, hasPickable := f64(in, "pickable_kg")
	if !hasPickable {
		writeErr(w, 400, "pickable_kg 必填（可采果数量）")
		return
	}

	var pid, reporterID int64
	var batchNo, kind string
	err := s.Pool.QueryRow(ctx,
		`SELECT project_id, batch_no, kind, COALESCE(reporter_id,0) FROM incidents WHERE id=$1`, incidentID).
		Scan(&pid, &batchNo, &kind, &reporterID)
	if err != nil {
		writeErr(w, 404, "冰雹工单不存在")
		return
	}
	if kind != "hail" {
		writeErr(w, 400, "只能为冰雹（hail）工单登记减产分配")
		return
	}
	if u.Role != "admin" && (u.FarmID == nil || *u.FarmID != farmIDOfProject(ctx, s, pid)) {
		writeErr(w, 403, "只能为本农场项目登记减产分配")
		return
	}
	var dup int
	_ = s.Pool.QueryRow(ctx, `SELECT count(*) FROM hail_allocations WHERE incident_id=$1`, incidentID).Scan(&dup)
	if dup > 0 {
		writeErr(w, 409, "该冰雹工单已登记减产分配")
		return
	}

	var sold int64
	var guarantee float64
	_ = s.Pool.QueryRow(ctx, `SELECT sold_shares, guarantee_kg FROM projects WHERE id=$1`, pid).Scan(&sold, &guarantee)
	promised := guarantee * float64(sold)
	shortage := promised - pickable
	if shortage < 0 {
		shortage = 0
	}

	// 保险报案：可挂已有报案，也可在此一并登记
	claimID, _ := i64(in, "insurance_claim_id")
	if claimID == 0 {
		if policy, _ := str(in, "insurance_policy_no"); policy != "" {
			loss, _ := f64(in, "insurance_loss_kg")
			amount, _ := f64(in, "insurance_amount")
			row, e := s.insertRow(ctx, "insurance_claims", map[string]interface{}{
				"project_id": pid, "batch_no": batchNo, "policy_no": policy,
				"kind": "冰雹", "loss_kg": loss, "amount": amount, "note": asString(in["insurance_note"]),
			})
			if e == nil {
				claimID, _ = asID(row["id"])
			}
		}
	}
	logID, _ := i64(in, "disaster_log_id")
	if logID == 0 {
		_ = s.Pool.QueryRow(ctx,
			`SELECT id FROM farm_logs WHERE project_id=$1 AND log_type='disaster' ORDER BY id DESC LIMIT 1`, pid).Scan(&logID)
	}

	creditDelta, hasDelta := f64(in, "credit_delta")
	if !hasDelta && promised > 0 {
		creditDelta = -(shortage / promised * 100)
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	var aid int64
	err = tx.QueryRow(ctx, `
		INSERT INTO hail_allocations(incident_id, project_id, batch_no, disaster_log_id, insurance_claim_id,
			affected_shares, promised_kg, pickable_kg, shortage_kg, plan_delay, plan_swap, plan_refund,
			new_eta_date, credit_delta, created_by)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
		incidentID, pid, batchNo, nullableID(logID), nullableID(claimID),
		sold, promised, pickable, shortage,
		asString(in["plan_delay"]), asString(in["plan_swap"]), asString(in["plan_refund"]),
		nullableDate(asString(in["new_eta_date"])), creditDelta, u.ID).Scan(&aid)
	if err != nil {
		writeErr(w, 400, "登记失败："+err.Error())
		return
	}
	_, _ = tx.Exec(ctx, `UPDATE incidents SET status='processing' WHERE id=$1`, incidentID)
	_, _ = tx.Exec(ctx, `
		INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
		VALUES($1,$2,$3,'登记冰雹减产分配',$4)`,
		incidentID, u.ID, u.Role,
		fmt.Sprintf("受灾照片已归档，保险报案%s；承诺总产量 %.2fkg，可采果 %.2fkg，保底缺口 %.2fkg，已拟定三选一补偿方案。",
			claimLabel(claimID), promised, pickable, shortage))
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_allocations WHERE id=$1`, aid)
	writeJSON(w, 201, row)
}

// ---------- 分配单详情 / 发布 / 关闭 ----------

// hailAllocationsRouter 处理 /api/hail-allocations/{id} 及
// /api/hail-allocations/{id}/choices|publish|close
func (s *Server) hailAllocationsRouter(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/hail-allocations/"), "/")
	parts := strings.Split(rest, "/")
	id, err := parseID(parts[0])
	if err != nil {
		writeErr(w, 404, "减产分配不存在")
		return
	}
	switch {
	case len(parts) == 1:
		s.hailAllocationDetail(w, r, id)
	case len(parts) == 2 && parts[1] == "choices":
		s.handleHailChoiceCreate(w, r, id)
	case len(parts) == 2 && parts[1] == "publish":
		s.hailPublish(w, r, id)
	case len(parts) == 2 && parts[1] == "close":
		s.hailClose(w, r, id)
	default:
		writeErr(w, 404, "未知操作")
	}
}

func (s *Server) hailAllocationDetail(w http.ResponseWriter, r *http.Request, id int64) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "方法不允许")
		return
	}
	ctx := r.Context()
	alloc, err := s.queryOne(ctx, `
		SELECT ha.*, p.title AS project_title, p.guarantee_kg, p.price_per_share,
		       f.renew_credit,
		       ic.status AS insurance_status, ic.policy_no, ic.amount AS insurance_amount,
		       fl.photos AS disaster_photos, fl.content AS disaster_content
		FROM hail_allocations ha
		JOIN projects p ON p.id=ha.project_id
		JOIN farms f ON f.id=p.farm_id
		LEFT JOIN insurance_claims ic ON ic.id=ha.insurance_claim_id
		LEFT JOIN farm_logs fl ON fl.id=ha.disaster_log_id
		WHERE ha.id=$1`, id)
	if err != nil {
		writeErr(w, 404, "减产分配不存在")
		return
	}
	choices, _ := s.queryRows(ctx, `
		SELECT hc.*, a.recipient_name, a.shares AS adoption_shares, a.amount AS adoption_amount,
		       u.name AS user_name, u.phone AS user_phone,
		       sp.title AS swap_project_title, sp.batch_no AS swap_batch_no
		FROM hail_choices hc
		JOIN adoptions a ON a.id=hc.adoption_id
		JOIN users u ON u.id=hc.user_id
		LEFT JOIN projects sp ON sp.id=hc.swap_project_id
		WHERE hc.allocation_id=$1 ORDER BY hc.id`, id)
	events, _ := s.queryRows(ctx, `
		SELECT e.*, u.name AS actor_name FROM incident_events e
		JOIN hail_allocations ha ON ha.incident_id=e.incident_id
		LEFT JOIN users u ON u.id=e.actor_id
		WHERE ha.id=$1 ORDER BY e.created_at`, id)
	writeJSON(w, 200, map[string]interface{}{
		"allocation": alloc, "choices": choices, "events": events,
	})
}

// hailPublish 发布三选一：为批次内每个认养订单生成待选择记录，并把理赔状态同步给认养人
func (s *Server) hailPublish(w http.ResponseWriter, r *http.Request, id int64) {
	u := s.currentUser(r)
	if r.Method != http.MethodPost {
		writeErr(w, 405, "方法不允许")
		return
	}
	ctx := r.Context()
	var pid, incidentID int64
	var status, batchNo string
	err := s.Pool.QueryRow(ctx,
		`SELECT project_id, incident_id, status, batch_no FROM hail_allocations WHERE id=$1`, id).
		Scan(&pid, &incidentID, &status, &batchNo)
	if err != nil {
		writeErr(w, 404, "减产分配不存在")
		return
	}
	if !requireRole(u, "admin", "service") &&
		!(u.Role == "farmer" && u.FarmID != nil && *u.FarmID == farmIDOfProject(ctx, s, pid)) {
		writeErr(w, 403, "只有农场/客服可以发布减产分配方案")
		return
	}
	if status == "published" || status == "closed" {
		writeErr(w, 409, "方案已发布，不能重复发布")
		return
	}
	adops, err := s.queryRows(ctx,
		`SELECT id, user_id FROM adoptions WHERE project_id=$1 ORDER BY id`, pid)
	if err != nil || len(adops) == 0 {
		writeErr(w, 400, "该批次暂无认养订单")
		return
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	for _, a := range adops {
		aid, _ := asID(a["id"])
		uid, _ := asID(a["user_id"])
		_, _ = tx.Exec(ctx, `
			INSERT INTO hail_choices(allocation_id, adoption_id, user_id, option)
			VALUES($1,$2,$3,'delay')
			ON CONFLICT (allocation_id, adoption_id) DO NOTHING`, id, aid, uid)
	}
	// 默认占位为 delay 但状态仍 pending；重置 option 以强制认养人显式选择
	_, _ = tx.Exec(ctx,
		`UPDATE hail_choices SET status='pending', confirmed_at=NULL WHERE allocation_id=$1 AND status='pending'`, id)
	_, _ = tx.Exec(ctx, `UPDATE hail_allocations SET status='published', published_at=now() WHERE id=$1`, id)
	_, _ = tx.Exec(ctx, `
		INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
		VALUES($1,$2,'service','推送冰雹减产三选一方案',$3)`,
		incidentID, u.ID, "受灾照片、保险报案、可采果数量已公示；认养人可在“我的认养”选择：①延期 ②换品类 ③按比例退款。")
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{"ok": true, "published_choices": len(adops), "batch_no": batchNo})
}

// hailClose 全部选择确认后关闭分配，同步农场续认信用
func (s *Server) hailClose(w http.ResponseWriter, r *http.Request, id int64) {
	u := s.currentUser(r)
	if r.Method != http.MethodPost {
		writeErr(w, 405, "方法不允许")
		return
	}
	ctx := r.Context()
	var pid, incidentID, affected int64
	var status string
	var creditDelta float64
	err := s.Pool.QueryRow(ctx,
		`SELECT project_id, incident_id, status, affected_shares, credit_delta FROM hail_allocations WHERE id=$1`,
		id).Scan(&pid, &incidentID, &status, &affected, &creditDelta)
	if err != nil {
		writeErr(w, 404, "减产分配不存在")
		return
	}
	if !requireRole(u, "admin", "service") &&
		!(u.Role == "farmer" && u.FarmID != nil && *u.FarmID == farmIDOfProject(ctx, s, pid)) {
		writeErr(w, 403, "只有农场/客服可以关闭减产分配")
		return
	}
	if status == "closed" {
		writeErr(w, 409, "分配已关闭")
		return
	}
	var total, confirmed int64
	_ = s.Pool.QueryRow(ctx, `SELECT count(*),
	        count(*) FILTER (WHERE status='confirmed') FROM hail_choices WHERE allocation_id=$1`, id).
		Scan(&total, &confirmed)
	if total == 0 {
		writeErr(w, 409, "尚未发布方案，无认养人选择")
		return
	}
	if confirmed < total {
		writeErr(w, 409, fmt.Sprintf("仍有 %d 位认养人未确认选择，不能关闭", total-confirmed))
		return
	}
	// 换品类必须客服确认
	var swapPending int64
	_ = s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM hail_choices WHERE allocation_id=$1 AND option='swap' AND service_status<>'confirmed'`,
		id).Scan(&swapPending)
	if swapPending > 0 {
		writeErr(w, 409, fmt.Sprintf("仍有 %d 笔换品类待客服确认", swapPending))
		return
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	_, _ = tx.Exec(ctx, `UPDATE hail_allocations SET status='closed', closed_at=now() WHERE id=$1`, id)
	_, _ = tx.Exec(ctx, `UPDATE incidents SET status='resolved', resolved_at=now() WHERE id=$1`, incidentID)

	// 农场续认信用同步变化（限制在 0~100）
	var farmID int64
	_ = tx.QueryRow(ctx, `SELECT farm_id FROM projects WHERE id=$1`, pid).Scan(&farmID)
	var oldCredit float64
	_ = tx.QueryRow(ctx, `SELECT renew_credit FROM farms WHERE id=$1`, farmID).Scan(&oldCredit)
	newCredit := oldCredit + creditDelta
	if newCredit < 0 {
		newCredit = 0
	}
	if newCredit > 100 {
		newCredit = 100
	}
	note := fmt.Sprintf("冰雹减产分配全部公平兑现，信用 %.2f→%.2f（%+.2f）", oldCredit, newCredit, creditDelta)
	_, _ = tx.Exec(ctx, `UPDATE farms SET renew_credit=$2, renew_credit_note=$3 WHERE id=$1`,
		farmID, newCredit, note)
	_, _ = tx.Exec(ctx, `
		INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
		VALUES($1,$2,$3,'减产分配全部确认并同步信用',$4)`,
		incidentID, u.ID, u.Role,
		fmt.Sprintf("%d 位认养人全部确认三选一，分配关闭；农场续认信用 %.2f→%.2f（%+.2f）。",
			confirmed, oldCredit, newCredit, creditDelta))
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"ok": true, "renew_credit": newCredit, "old_renew_credit": oldCredit, "confirmed": confirmed,
	})
}

// ---------- 认养人三选一 / 换品类批次再确认 / 客服确认 ----------

func (s *Server) handleHailChoiceByID(w http.ResponseWriter, r *http.Request) {
	id, action, ok := pathParts("/api/hail-choices/", r.URL.Path)
	if !ok || r.Method != http.MethodPost {
		writeErr(w, 404, "选择记录不存在")
		return
	}
	switch action {
	case "batch":
		s.hailConfirmBatch(w, r, id)
	case "service":
		s.hailServiceConfirm(w, r, id)
	default:
		writeErr(w, 404, "未知操作")
	}
}

// handleHailChoiceCreate 认养人提交三选一  POST /api/hail-allocations/{id}/choices
func (s *Server) handleHailChoiceCreate(w http.ResponseWriter, r *http.Request, allocID int64) {
	u := s.currentUser(r)
	var in map[string]interface{}
	if err := decode(r, &in); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	option, _ := str(in, "option")
	if !map[string]bool{"delay": true, "swap": true, "refund": true}[option] {
		writeErr(w, 400, "option 只能是 delay/swap/refund（延期/换品类/按比例退款）")
		return
	}
	ctx := r.Context()

	var pid, incidentID, adoptionID, userID int64
	var allocStatus string
	var newETA string
	err := s.Pool.QueryRow(ctx, `
		SELECT ha.project_id, ha.incident_id, ha.status, COALESCE(ha.new_eta_date::text,'')
		FROM hail_allocations ha WHERE ha.id=$1`, allocID).
		Scan(&pid, &incidentID, &allocStatus, &newETA)
	if err != nil {
		writeErr(w, 404, "减产分配不存在")
		return
	}
	if allocStatus != "published" && allocStatus != "closed" {
		writeErr(w, 409, "减产分配方案尚未发布")
		return
	}
	// 认养人为本批次订单选择；客服/管理员可代任意订单（body 带 adoption_id）
	if aid, ok := i64(in, "adoption_id"); ok {
		var owner int64
		err = s.Pool.QueryRow(ctx, `SELECT user_id FROM adoptions WHERE id=$1 AND project_id=$2`, aid, pid).
			Scan(&owner)
		if err != nil {
			writeErr(w, 404, "订单不存在或不属于该批次")
			return
		}
		if owner != u.ID && u.Role != "service" && u.Role != "admin" {
			writeErr(w, 403, "只能为本人订单选择减产分配方案")
			return
		}
		adoptionID = aid
		userID = owner
	} else {
		err = s.Pool.QueryRow(ctx,
			`SELECT id, user_id FROM adoptions WHERE project_id=$1 AND user_id=$2 ORDER BY id LIMIT 1`,
			pid, u.ID).Scan(&adoptionID, &userID)
		if err != nil {
			writeErr(w, 403, "你在该批次没有认养订单")
			return
		}
	}
	if adoptionID == 0 {
		writeErr(w, 400, "adoption_id 必填")
		return
	}

	var choiceID int64
	var exists bool
	_ = s.Pool.QueryRow(ctx, `SELECT id, TRUE FROM hail_choices WHERE allocation_id=$1 AND adoption_id=$2`,
		allocID, adoptionID).Scan(&choiceID, &exists)
	if !exists {
		writeErr(w, 404, "未找到你的待选择记录，请等待客服发布方案")
		return
	}
	var curStatus string
	_ = s.Pool.QueryRow(ctx, `SELECT status FROM hail_choices WHERE id=$1`, choiceID).Scan(&curStatus)
	if curStatus == "confirmed" && !(u.Role == "service" || u.Role == "admin") {
		writeErr(w, 409, "已确认选择，不能重复提交；如需变更请联系客服")
		return
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)

	switch option {
	case "delay":
		eta := asString(in["eta_date"])
		if eta == "" {
			eta = newETA
		}
		_, err = tx.Exec(ctx, `
			UPDATE hail_choices SET option='delay', status='confirmed', eta_date=$2, note=$3, confirmed_at=now()
			WHERE id=$1`, choiceID, nullableDate(eta), asString(in["note"]))
		if err == nil && eta != "" {
			// 更新该订单未发批次的计划/预计到货时间
			_, _ = tx.Exec(ctx, `UPDATE shipments SET eta_date=$2
				WHERE adoption_id=$1 AND status IN ('planned','picked','packed') AND eta_date IS DISTINCT FROM $2`,
				adoptionID, eta)
		}
		reason := fmt.Sprintf("冰雹减产分配：认养人选择延期，未发批次预计 %s 到货，保底权益不变，证书换发。", etaOrTBD(eta))
		certNo, ver, e := s.reissueCertificate(ctx, tx, adoptionID, reason)
		if e != nil {
			writeErr(w, 500, "证书换发失败："+e.Error())
			return
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,'adopter','选择延期交付',$3)`,
			incidentID, u.ID, fmt.Sprintf("订单 #%d 选择延期，预计 %s 到货，证书已换发至第 %d 版（%s）。",
				adoptionID, etaOrTBD(eta), ver, certNo))

	case "refund":
		// 按比例退款：退款额=订单金额×缺口比例（可由前端覆盖 refund_pct/amount）
		var unitTotal float64
		_ = tx.QueryRow(ctx, `SELECT amount FROM adoptions WHERE id=$1`, adoptionID).Scan(&unitTotal)
		var promised, pickable float64
		_ = tx.QueryRow(ctx, `SELECT promised_kg, pickable_kg FROM hail_allocations WHERE id=$1`,
			allocID).Scan(&promised, &pickable)
		pct := 0.0
		if promised > 0 {
			pct = (promised - pickable) / promised * 100
		}
		if p, ok := f64(in, "refund_pct"); ok && p > 0 {
			pct = p
		}
		refund := unitTotal * pct / 100
		if a, ok := f64(in, "refund_amount"); ok && a > 0 {
			refund = a
		}
		_, err = tx.Exec(ctx, `
			UPDATE hail_choices SET option='refund', status='confirmed', refund_pct=$2, refund_amount=$3,
			       note=$4, confirmed_at=now()
			WHERE id=$1`, choiceID, pct, refund, asString(in["note"]))
		if err == nil {
			_, _ = tx.Exec(ctx, `
				INSERT INTO compensations(incident_id, adoption_id, project_id, amount, kind, note, status, paid_at)
				VALUES($1,$2,$3,$4,'cash',$5,'paid',now())`,
				incidentID, adoptionID, pid, refund,
				fmt.Sprintf("冰雹减产按比例退款 %.2f%%（订单 ¥%.2f × %.2f%%），原路退回。", pct, unitTotal, pct))
		}
		reason := fmt.Sprintf("冰雹减产分配：认养人选择按比例退款 %.2f%%（¥%.2f 已退回），证书换发留存。", pct, refund)
		certNo, ver, e := s.reissueCertificate(ctx, tx, adoptionID, reason)
		if e != nil {
			writeErr(w, 500, "证书换发失败："+e.Error())
			return
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,'adopter','选择按比例退款',$3)`,
			incidentID, u.ID, fmt.Sprintf("订单 #%d 按缺口比例 %.2f%% 退款 ¥%.2f，证书已换发至第 %d 版（%s）。",
				adoptionID, pct, refund, ver, certNo))

	case "swap":
		swapProjectID, _ := i64(in, "swap_project_id")
		if swapProjectID == 0 {
			writeErr(w, 400, "换品类需指定 swap_project_id（换购项目）")
			return
		}
		var sameFarm bool
		_ = tx.QueryRow(ctx, `SELECT (SELECT farm_id FROM projects WHERE id=$1)=(SELECT farm_id FROM projects WHERE id=$2)`,
			pid, swapProjectID).Scan(&sameFarm)
		if !sameFarm {
			writeErr(w, 400, "只能换购本农场其他品类")
			return
		}
		// 等值兑换份额：订单金额 / 换购项目单价（四舍五入到整数份额）
		var swapPrice, swapGuarantee float64
		var swapUnit string
		_ = tx.QueryRow(ctx, `SELECT price_per_share, guarantee_kg, unit_name FROM projects WHERE id=$1`,
			swapProjectID).Scan(&swapPrice, &swapGuarantee, &swapUnit)
		var orderAmount float64
		_ = tx.QueryRow(ctx, `SELECT amount FROM adoptions WHERE id=$1`, adoptionID).Scan(&orderAmount)
		swapShares := int64(0)
		if swapPrice > 0 {
			swapShares = int64(orderAmount/swapPrice + 0.5)
		}
		if v, ok := i64(in, "swap_shares"); ok && v > 0 {
			swapShares = v
		}
		// 拟配送批次：待客服确认、再由认养人重新确认
		batchSeq, _ := i64(in, "batch_seq")
		if batchSeq == 0 {
			batchSeq = 1
		}
		batchDate := asString(in["batch_plan_date"])
		batchSpec := asString(in["batch_spec"])
		batchETA := asString(in["batch_eta_date"])
		_, err = tx.Exec(ctx, `
			UPDATE hail_choices SET option='swap', status='confirmed', swap_project_id=$2, swap_shares=$3,
			       batch_seq=$4, batch_plan_date=$5, batch_spec=$6, batch_eta_date=$7, batch_status='pending',
			       service_status='pending', eta_date=NULL, note=$8, confirmed_at=now()
			WHERE id=$1`,
			choiceID, swapProjectID, swapShares, batchSeq, nullableDate(batchDate), batchSpec,
			nullableDate(batchETA), asString(in["note"]))
		if err != nil {
			writeErr(w, 400, "保存换品类失败："+err.Error())
			return
		}
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,'adopter','选择换品类',$3)`,
			incidentID, u.ID, fmt.Sprintf("订单 #%d 申请换品类：等值兑换 %d %s（换购份额），等待客服确认并重新编排配送批次。",
				adoptionID, swapShares, swapUnit))
	}

	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_choices WHERE id=$1`, choiceID)
	writeJSON(w, 200, row)
}

// hailServiceConfirm 客服确认换品类（结果同步客服台账）
func (s *Server) hailServiceConfirm(w http.ResponseWriter, r *http.Request, choiceID int64) {
	u := s.currentUser(r)
	if !requireRole(u, "service", "admin") {
		writeErr(w, 403, "只有客服可以确认换品类")
		return
	}
	var in map[string]interface{}
	_ = decode(r, &in)
	reject := asString(in["action"]) == "reject"
	ctx := r.Context()
	var incidentID, adoptionID, swapProjectID, swapShares int64
	var option, spec string
	var batchSeq int64
	var batchDate, batchETA string
	err := s.Pool.QueryRow(ctx, `
		SELECT ha.incident_id, hc.adoption_id, hc.option, COALESCE(hc.swap_project_id,0), hc.swap_shares,
		       COALESCE(hc.batch_seq,1), COALESCE(hc.batch_plan_date::text,''), hc.batch_spec,
		       COALESCE(hc.batch_eta_date::text,'')
		FROM hail_choices hc JOIN hail_allocations ha ON ha.id=hc.allocation_id
		WHERE hc.id=$1`, choiceID).
		Scan(&incidentID, &adoptionID, &option, &swapProjectID, &swapShares, &batchSeq, &batchDate, &spec, &batchETA)
	if err != nil {
		writeErr(w, 404, "选择记录不存在")
		return
	}
	if option != "swap" {
		writeErr(w, 400, "该选择不是换品类")
		return
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	note := asString(in["note"])
	if reject {
		_, _ = tx.Exec(ctx,
			`UPDATE hail_choices SET service_status='rejected', service_id=$2, service_note=$3, serviced_at=now()
			 WHERE id=$1`, choiceID, u.ID, note)
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,'service','驳回换品类申请',$3)`, incidentID, u.ID, fmt.Sprintf("订单 #%d：%s", adoptionID, note))
	} else {
		// 客服可修订配送批次安排
		if v, _ := i64(in, "batch_seq"); v > 0 {
			batchSeq = v
		}
		if v, _ := str(in, "batch_plan_date"); v != "" {
			batchDate = v
		}
		if v, _ := str(in, "batch_spec"); v != "" {
			spec = v
		}
		if v, _ := str(in, "batch_eta_date"); v != "" {
			batchETA = v
		}
		var swapBatchNo string
		_ = tx.QueryRow(ctx, `SELECT batch_no FROM projects WHERE id=$1`, swapProjectID).Scan(&swapBatchNo)
		_, err = tx.Exec(ctx, `
			UPDATE hail_choices SET service_status='confirmed', service_id=$2, service_note=$3, serviced_at=now(),
			       batch_seq=$4, batch_plan_date=$5, batch_spec=$6, batch_eta_date=$7, batch_status='pending'
			WHERE id=$1`,
			choiceID, u.ID, note, batchSeq, nullableDate(batchDate), spec, nullableDate(batchETA))
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		// 换品类结果同步客服：在换购批次项目下预排一笔运单（planned），等待认养人重新确认配送批次
		var shipID int64
		var weight float64
		_ = tx.QueryRow(ctx, `
			SELECT COALESCE(p.guarantee_kg,0)*hc.swap_shares
			FROM hail_choices hc JOIN projects p ON p.id=hc.swap_project_id
			WHERE hc.id=$1`, choiceID).Scan(&weight)
		_ = tx.QueryRow(ctx, `
			INSERT INTO shipments(project_id, adoption_id, batch_no, seq, plan_date, eta_date, pack_spec,
				weight_kg, status, hail_choice_id)
			VALUES($1,$2,$3,$4,$5,$6,$7,$8,'planned',$9)
			RETURNING id`,
			swapProjectID, adoptionID, swapBatchNo, batchSeq, nullableDate(batchDate), nullableDate(batchETA),
			spec, nullableF64(weight), choiceID).Scan(&shipID)
		_, _ = tx.Exec(ctx, `
			INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
			VALUES($1,$2,'service','客服确认换品类并同步',$3)`,
			incidentID, u.ID, fmt.Sprintf(
				"订单 #%d 换品类已确认（%d 份换购份额，批次 %s），结果同步客服台账与冷链；待认养人重新确认配送批次。",
				adoptionID, swapShares, swapBatchNo))
	}
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_choices WHERE id=$1`, choiceID)
	writeJSON(w, 200, row)
}

// hailConfirmBatch 选择换品类的认养人重新确认配送批次
func (s *Server) hailConfirmBatch(w http.ResponseWriter, r *http.Request, choiceID int64) {
	u := s.currentUser(r)
	var in map[string]interface{}
	_ = decode(r, &in)
	ctx := r.Context()
	var incidentID, adoptionID, ownerID, swapProjectID int64
	var option, serviceStatus, certReason, spec string
	var batchSeq int64
	var batchDate, batchETA string
	err := s.Pool.QueryRow(ctx, `
		SELECT ha.incident_id, hc.adoption_id, hc.user_id, hc.option, hc.service_status,
		       COALESCE(hc.swap_project_id,0), COALESCE(hc.batch_seq,1),
		       COALESCE(hc.batch_plan_date::text,''), COALESCE(hc.batch_eta_date::text,''), hc.batch_spec
		FROM hail_choices hc JOIN hail_allocations ha ON ha.id=hc.allocation_id
		WHERE hc.id=$1`, choiceID).
		Scan(&incidentID, &adoptionID, &ownerID, &option, &serviceStatus, &swapProjectID,
			&batchSeq, &batchDate, &batchETA, &spec)
	if err != nil {
		writeErr(w, 404, "选择记录不存在")
		return
	}
	if option != "swap" {
		writeErr(w, 400, "该选择不是换品类")
		return
	}
	if serviceStatus != "confirmed" {
		writeErr(w, 409, "换品类尚待客服确认，确认后才能选择配送批次")
		return
	}
	if u.ID != ownerID && u.Role != "service" && u.Role != "admin" {
		writeErr(w, 403, "只能由本人确认配送批次")
		return
	}
	// 认养人可微调批次（接受客服安排或改期）
	if v, _ := i64(in, "batch_seq"); v > 0 {
		batchSeq = v
	}
	if v, _ := str(in, "batch_plan_date"); v != "" {
		batchDate = v
	}
	if v, _ := str(in, "batch_eta_date"); v != "" {
		batchETA = v
	}
	if v, _ := str(in, "batch_spec"); v != "" {
		spec = v
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		UPDATE hail_choices SET batch_status='confirmed', batch_seq=$2, batch_plan_date=$3,
		       batch_spec=$4, batch_eta_date=$5, eta_date=$5
		WHERE id=$1`,
		choiceID, batchSeq, nullableDate(batchDate), spec, nullableDate(batchETA))
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	// 落到换购运单：确定计划/预计到货
	_, _ = tx.Exec(ctx, `
		UPDATE shipments SET seq=$2, plan_date=$3, eta_date=$4, pack_spec=COALESCE(NULLIF($5,''),pack_spec)
		WHERE hail_choice_id=$1`,
		choiceID, batchSeq, nullableDate(batchDate), nullableDate(batchETA), spec)
	var swapTitle, swapBatch string
	_ = tx.QueryRow(ctx, `SELECT title, batch_no FROM projects WHERE id=$1`, swapProjectID).
		Scan(&swapTitle, &swapBatch)
	certReason = fmt.Sprintf(
		"冰雹减产分配：认养人选择换品类并重新确认配送批次（%s / %s 第 %d 批，%s 发货、%s 到货），认养证书换发。",
		swapTitle, swapBatch, batchSeq, etaOrTBD(batchDate), etaOrTBD(batchETA))
	certNo, ver, e := s.reissueCertificate(ctx, tx, adoptionID, certReason)
	if e != nil {
		writeErr(w, 500, "证书换发失败："+e.Error())
		return
	}
	_, _ = tx.Exec(ctx, `
		INSERT INTO incident_events(incident_id, actor_id, actor_role, action, note)
		VALUES($1,$2,'adopter','重新确认换品类配送批次',$3)`,
		incidentID, u.ID, fmt.Sprintf(
			"订单 #%d 确认换购第 %d 批：%s 发货、%s 到货；认养证书已换发至第 %d 版（%s）。",
			adoptionID, batchSeq, etaOrTBD(batchDate), etaOrTBD(batchETA), ver, certNo))
	if err := tx.Commit(ctx); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	row, _ := s.queryOne(ctx, `SELECT * FROM hail_choices WHERE id=$1`, choiceID)
	writeJSON(w, 200, row)
}

// hailChoiceForAdoption 聚合某订单的冰雹减产分配与选择（供 /api/my/adoptions）
func (s *Server) hailChoiceForAdoption(ctx context.Context, adoptionID int64) map[string]interface{} {
	row, err := s.queryOne(ctx, `
		SELECT hc.*, ha.incident_id, ha.promised_kg, ha.pickable_kg, ha.shortage_kg,
		       ha.plan_delay, ha.plan_swap, ha.plan_refund, ha.new_eta_date, ha.status AS allocation_status,
		       ha.credit_delta,
		       ic.status AS insurance_status, ic.policy_no, ic.amount AS insurance_amount,
		       sp.title AS swap_project_title, sp.batch_no AS swap_batch_no, sp.kind AS swap_kind
		FROM hail_choices hc
		JOIN hail_allocations ha ON ha.id=hc.allocation_id
		LEFT JOIN insurance_claims ic ON ic.id=ha.insurance_claim_id
		LEFT JOIN projects sp ON sp.id=hc.swap_project_id
		WHERE hc.adoption_id=$1 ORDER BY hc.id DESC LIMIT 1`, adoptionID)
	if err != nil {
		return nil
	}
	return row
}

func etaOrTBD(d string) string {
	if d == "" {
		return "待排期"
	}
	return d
}
