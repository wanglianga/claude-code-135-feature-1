package api

import (
	"fmt"
	"net/http"
)

// ---------- 成熟度回访 ----------

func (s *Server) handleCallbacks(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	ctx := r.Context()
	switch r.Method {
	case http.MethodGet:
		q := `SELECT cb.*, p.title AS project_title, a.recipient_name
		      FROM callbacks cb
		      JOIN projects p ON p.id=cb.project_id
		      JOIN adoptions a ON a.id=cb.adoption_id`
		args := []interface{}{}
		if u.Role == "adopter" {
			q += " WHERE a.user_id=$1"
			args = append(args, u.ID)
		} else if u.FarmID != nil && u.Role != "admin" && u.Role != "service" {
			q += " WHERE p.farm_id=$1"
			args = append(args, *u.FarmID)
		}
		q += " ORDER BY cb.id DESC"
		rows, err := s.queryRows(ctx, q, args...)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, rows)
	case http.MethodPost:
		var in struct {
			AdoptionID      int64  `json:"adoption_id"`
			Satisfaction    int    `json:"satisfaction"`
			QualityScore    int    `json:"quality_score"`
			DeliveryScore   int    `json:"delivery_score"`
			WouldRenew      bool   `json:"would_renew"`
			Comment         string `json:"comment"`
			RenewSuggestion string `json:"renew_suggestion"`
		}
		if err := decode(r, &in); err != nil || in.AdoptionID == 0 {
			writeErr(w, 400, "adoption_id 必填")
			return
		}
		if in.Satisfaction < 1 || in.Satisfaction > 5 || in.QualityScore < 1 ||
			in.QualityScore > 5 || in.DeliveryScore < 1 || in.DeliveryScore > 5 {
			writeErr(w, 400, "评分必须在 1-5 之间")
			return
		}
		var pid, owner int64
		err := s.Pool.QueryRow(ctx,
			`SELECT project_id, user_id FROM adoptions WHERE id=$1`, in.AdoptionID).
			Scan(&pid, &owner)
		if err != nil {
			writeErr(w, 404, "订单不存在")
			return
		}
		if owner != u.ID && u.Role != "service" && u.Role != "admin" {
			writeErr(w, 403, "只能对本人订单做回访")
			return
		}
		row, err := s.insertRow(ctx, "callbacks", map[string]interface{}{
			"project_id":       pid,
			"adoption_id":      in.AdoptionID,
			"satisfaction":     in.Satisfaction,
			"quality_score":    in.QualityScore,
			"delivery_score":   in.DeliveryScore,
			"would_renew":      in.WouldRenew,
			"comment":          in.Comment,
			"renew_suggestion": in.RenewSuggestion,
		})
		if err != nil {
			writeErr(w, 400, "回访失败："+err.Error())
			return
		}
		writeJSON(w, 201, row)
	default:
		writeErr(w, 405, "方法不允许")
	}
}

// ---------- 直播 ----------

func (s *Server) handleLive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeErr(w, 405, "方法不允许")
		return
	}
	q := `SELECT ls.*, f.name AS farm_name, p.title AS project_title
	      FROM live_streams ls JOIN farms f ON f.id=ls.farm_id
	      LEFT JOIN projects p ON p.id=ls.project_id`
	args := []interface{}{}
	if fid := r.URL.Query().Get("farm_id"); fid != "" {
		q += " WHERE ls.farm_id=$1"
		args = append(args, fid)
	}
	q += " ORDER BY ls.starts_at DESC"
	rows, err := s.queryRows(r.Context(), q, args...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, rows)
}

func (s *Server) handleLiveByID(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathParts("/api/live/", r.URL.Path)
	if !ok || r.Method != http.MethodPost {
		writeErr(w, 404, "直播不存在")
		return
	}
	u := s.currentUser(r)
	var in map[string]interface{}
	_ = decode(r, &in)
	status, _ := str(in, "status")
	if !map[string]bool{"live": true, "ended": true, "scheduled": true}[status] {
		writeErr(w, 400, "status 只能是 scheduled/live/ended")
		return
	}
	var farmID int64
	err := s.Pool.QueryRow(r.Context(), `SELECT farm_id FROM live_streams WHERE id=$1`, id).Scan(&farmID)
	if err != nil {
		writeErr(w, 404, "直播不存在")
		return
	}
	if u.Role != "admin" && (u.FarmID == nil || *u.FarmID != farmID) {
		writeErr(w, 403, "只能管理本农场直播")
		return
	}
	row, err := s.queryOne(r.Context(),
		`UPDATE live_streams SET status=$1 WHERE id=$2 RETURNING *`, status, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, row)
}

// ---------- 地块参观 ----------

func (s *Server) handleVisits(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	ctx := r.Context()
	switch r.Method {
	case http.MethodGet:
		q := `SELECT v.*, pl.name AS plot_name, us.name AS user_name
		      FROM visits v JOIN plots pl ON pl.id=v.plot_id
		      LEFT JOIN users us ON us.id=v.user_id`
		args := []interface{}{}
		if u.Role == "adopter" {
			q += " WHERE v.user_id=$1"
			args = append(args, u.ID)
		} else if u.FarmID != nil && u.Role != "admin" {
			q += " WHERE pl.farm_id=$1"
			args = append(args, *u.FarmID)
		}
		q += " ORDER BY v.visit_date"
		rows, err := s.queryRows(ctx, q, args...)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, rows)
	case http.MethodPost:
		var in struct {
			PlotID    int64  `json:"plot_id"`
			VisitDate string `json:"visit_date"`
			Visitors  int    `json:"visitors"`
			Note      string `json:"note"`
		}
		if err := decode(r, &in); err != nil || in.PlotID == 0 || in.VisitDate == "" {
			writeErr(w, 400, "plot_id/visit_date 必填")
			return
		}
		if in.Visitors <= 0 {
			in.Visitors = 1
		}
		row, err := s.insertRow(ctx, "visits", map[string]interface{}{
			"plot_id":    in.PlotID,
			"user_id":    u.ID,
			"visit_date": in.VisitDate,
			"visitors":   in.Visitors,
			"note":       in.Note,
		})
		if err != nil {
			writeErr(w, 400, "预约失败："+err.Error())
			return
		}
		writeJSON(w, 201, row)
	default:
		writeErr(w, 405, "方法不允许")
	}
}

func (s *Server) handleVisitByID(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathParts("/api/visits/", r.URL.Path)
	if !ok || r.Method != http.MethodPost {
		writeErr(w, 404, "预约不存在")
		return
	}
	u := s.currentUser(r)
	var in map[string]interface{}
	_ = decode(r, &in)
	status, _ := str(in, "status")
	if !map[string]bool{"approved": true, "finished": true, "canceled": true, "pending": true}[status] {
		writeErr(w, 400, "状态非法")
		return
	}
	var farmID int64
	err := s.Pool.QueryRow(r.Context(),
		`SELECT pl.farm_id FROM visits v JOIN plots pl ON pl.id=v.plot_id WHERE v.id=$1`, id).Scan(&farmID)
	if err != nil {
		writeErr(w, 404, "预约不存在")
		return
	}
	if u.Role != "admin" && (u.FarmID == nil || *u.FarmID != farmID) {
		writeErr(w, 403, "只能由农场方审核")
		return
	}
	row, err := s.queryOne(r.Context(), `UPDATE visits SET status=$1, note=COALESCE(NULLIF($2,''),note) WHERE id=$3 RETURNING *`,
		status, asString(in["note"]), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, row)
}

// ---------- 企业团购 ----------

func (s *Server) handleGroupBuys(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		rows, err := s.queryRows(r.Context(),
			`SELECT gb.*, p.title AS project_title FROM group_buys gb
		     JOIN projects p ON p.id=gb.project_id ORDER BY gb.id DESC`)
		if err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, rows)
	case http.MethodPost:
		u := s.currentUser(r)
		if u == nil {
			writeErr(w, 401, "请先登录后提交团购需求")
			return
		}
		var in struct {
			ProjectID   int64   `json:"project_id"`
			CompanyName string  `json:"company_name"`
			Contact     string  `json:"contact"`
			Phone       string  `json:"phone"`
			Shares      int64   `json:"shares"`
			DiscountPct float64 `json:"discount_pct"`
		}
		if err := decode(r, &in); err != nil || in.ProjectID == 0 || in.CompanyName == "" || in.Shares <= 0 {
			writeErr(w, 400, "project_id/company_name/shares 必填")
			return
		}
		row, err := s.insertRow(r.Context(), "group_buys", map[string]interface{}{
			"project_id":   in.ProjectID,
			"company_name": in.CompanyName,
			"contact":      in.Contact,
			"phone":        in.Phone,
			"shares":       in.Shares,
			"discount_pct": in.DiscountPct,
		})
		if err != nil {
			writeErr(w, 400, "提交失败："+err.Error())
			return
		}
		writeJSON(w, 201, row)
	default:
		writeErr(w, 405, "方法不允许")
	}
}

func (s *Server) handleGroupBuyByID(w http.ResponseWriter, r *http.Request) {
	id, _, ok := pathParts("/api/group-buys/", r.URL.Path)
	if !ok || r.Method != http.MethodPost {
		writeErr(w, 404, "团购不存在")
		return
	}
	u := s.currentUser(r)
	var in map[string]interface{}
	_ = decode(r, &in)
	status, _ := str(in, "status")
	if !map[string]bool{"confirmed": true, "fulfilled": true, "canceled": true, "pending": true}[status] {
		writeErr(w, 400, "状态非法")
		return
	}
	if !requireRole(u, "farmer", "admin", "service") {
		writeErr(w, 403, "只有农场方可以处理团购")
		return
	}
	row, err := s.queryOne(r.Context(), `UPDATE group_buys SET status=$1 WHERE id=$2 RETURNING *`, status, id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, row)
}

// ---------- 公益认养（公开浏览） ----------

func (s *Server) handleCharity(w http.ResponseWriter, r *http.Request) {
	rows, err := s.queryRows(r.Context(), `
		SELECT ca.*, p.title AS project_title, f.name AS farm_name
		FROM charity_adoptions ca
		JOIN projects p ON p.id=ca.project_id
		JOIN farms f ON f.id=p.farm_id
		ORDER BY ca.id DESC`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, rows)
}

// ---------- 农场看板 ----------

func (s *Server) handleFarmDashboard(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u.FarmID == nil && u.Role != "admin" {
		writeErr(w, 400, "当前账号未关联农场")
		return
	}
	farmID := int64(1)
	if u.FarmID != nil {
		farmID = *u.FarmID
	}
	if fid := r.URL.Query().Get("farm_id"); fid != "" && u.Role == "admin" {
		fmt.Sscanf(fid, "%d", &farmID)
	}
	ctx := r.Context()
	projects, _ := s.queryRows(ctx, `
		SELECT p.id, p.batch_no, p.title, p.kind, p.status, p.total_shares, p.sold_shares,
		       p.price_per_share, p.est_mature_date,
		       (SELECT COALESCE(SUM(actual_kg),0) FROM harvest_tasks WHERE project_id=p.id) AS harvested_kg,
		       (SELECT COALESCE(SUM(weight_kg),0) FROM shipments WHERE project_id=p.id AND status<>'planned') AS shipped_kg,
		       (SELECT COALESCE(AVG(satisfaction),0) FROM callbacks cb WHERE cb.project_id=p.id) AS avg_satisfaction,
		       (SELECT COALESCE(AVG(CASE WHEN would_renew THEN 100 ELSE 0 END),0) FROM callbacks cb WHERE cb.project_id=p.id) AS renew_rate
		FROM projects p WHERE p.farm_id=$1 ORDER BY p.id`, farmID)
	plots, _ := s.queryRows(ctx, `
		SELECT pl.*,
		  (SELECT COALESCE(SUM(amount),0) FROM plot_costs WHERE plot_id=pl.id AND season='2026') AS season_cost,
		  (SELECT count(*) FROM projects WHERE plot_id=pl.id) AS project_count
		FROM plots pl WHERE pl.farm_id=$1 ORDER BY pl.id`, farmID)
	openIncidents, _ := s.queryRows(ctx, `
		SELECT i.id, i.kind, i.title, i.status, i.created_at, p.title AS project_title
		FROM incidents i JOIN projects p ON p.id=i.project_id
		WHERE p.farm_id=$1 AND i.status IN ('open','processing') ORDER BY i.created_at DESC`, farmID)
	todayShipments, _ := s.queryRows(ctx, `
		SELECT sh.id, sh.status, sh.seq, sh.plan_date, sh.cold_route, p.title AS project_title,
		       a.recipient_name
		FROM shipments sh JOIN projects p ON p.id=sh.project_id
		LEFT JOIN adoptions a ON a.id=sh.adoption_id
		WHERE p.farm_id=$1 AND sh.status IN ('planned','picked','packed','shipped')
		ORDER BY sh.plan_date, sh.seq`, farmID)

	stats := map[string]interface{}{}
	var (
		vInt                               int64
		vSales, vCost, vComp, vSat, vRenew float64
	)
	_ = s.Pool.QueryRow(ctx, `SELECT count(*) FROM projects WHERE farm_id=$1`, farmID).Scan(&vInt)
	stats["project_count"] = vInt
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(sold_shares),0) FROM projects WHERE farm_id=$1`, farmID).Scan(&vInt)
	stats["sold_shares"] = vInt
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM adoptions a JOIN projects p ON p.id=a.project_id WHERE p.farm_id=$1`, farmID).Scan(&vSales)
	stats["total_sales"] = vSales
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM plot_costs pc JOIN plots pl ON pl.id=pc.plot_id WHERE pl.farm_id=$1 AND season='2026'`, farmID).Scan(&vCost)
	stats["total_cost"] = vCost
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(SUM(amount),0) FROM compensations c JOIN projects p ON p.id=c.project_id WHERE p.farm_id=$1 AND c.status='paid'`, farmID).Scan(&vComp)
	stats["total_compensation"] = vComp
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(AVG(satisfaction),0) FROM callbacks cb JOIN projects p ON p.id=cb.project_id WHERE p.farm_id=$1`, farmID).Scan(&vSat)
	stats["avg_satisfaction"] = vSat
	_ = s.Pool.QueryRow(ctx, `SELECT COALESCE(AVG(CASE WHEN would_renew THEN 100 ELSE 0 END),0) FROM callbacks cb JOIN projects p ON p.id=cb.project_id WHERE p.farm_id=$1`, farmID).Scan(&vRenew)
	stats["renew_rate"] = vRenew
	var credit float64
	var creditNote string
	_ = s.Pool.QueryRow(ctx, `SELECT renew_credit, COALESCE(renew_credit_note,'') FROM farms WHERE id=$1`, farmID).
		Scan(&credit, &creditNote)
	stats["renew_credit"] = credit
	stats["renew_credit_note"] = creditNote
	var hailCount int64
	_ = s.Pool.QueryRow(ctx,
		`SELECT count(*) FROM hail_allocations ha JOIN projects p ON p.id=ha.project_id WHERE p.farm_id=$1`, farmID).
		Scan(&hailCount)
	stats["hail_allocations"] = hailCount

	writeJSON(w, 200, map[string]interface{}{
		"farm_id":          farmID,
		"projects":         projects,
		"plots":            plots,
		"open_incidents":   openIncidents,
		"active_shipments": todayShipments,
		"stats":            stats,
	})
}

// ---------- 平台总览（管理员） ----------

func (s *Server) handleAdminOverview(w http.ResponseWriter, r *http.Request) {
	u := s.currentUser(r)
	if u.Role != "admin" {
		writeErr(w, 403, "仅平台管理员可查看")
		return
	}
	ctx := r.Context()
	stats := map[string]interface{}{}
	var iVal int64
	var fVal float64
	scanInt := func(q string) int64 {
		_ = s.Pool.QueryRow(ctx, q).Scan(&iVal)
		return iVal
	}
	scanFloat := func(q string) float64 {
		_ = s.Pool.QueryRow(ctx, q).Scan(&fVal)
		return fVal
	}
	stats["farms"] = scanInt(`SELECT count(*) FROM farms`)
	stats["projects"] = scanInt(`SELECT count(*) FROM projects`)
	stats["adoptions"] = scanInt(`SELECT count(*) FROM adoptions`)
	stats["users"] = scanInt(`SELECT count(*) FROM users`)
	stats["open_incidents"] = scanInt(`SELECT count(*) FROM incidents WHERE status IN ('open','processing')`)
	stats["total_sales"] = scanFloat(`SELECT COALESCE(SUM(amount),0) FROM adoptions`)
	stats["total_compensation"] = scanFloat(`SELECT COALESCE(SUM(amount),0) FROM compensations WHERE status='paid'`)
	stats["charity_shares"] = scanInt(`SELECT COALESCE(SUM(shares),0) FROM charity_adoptions`)
	stats["group_buy_count"] = scanInt(`SELECT count(*) FROM group_buys`)
	stats["insurance_settled"] = scanFloat(`SELECT COALESCE(SUM(amount),0) FROM insurance_claims WHERE status='settled'`)

	byKind, _ := s.queryRows(ctx, `
		SELECT kind, COUNT(*) AS n, COALESCE(SUM(sold_shares),0) AS sold,
		       COALESCE(AVG((SELECT satisfaction FROM callbacks WHERE callbacks.project_id=projects.id LIMIT 1)),0) AS sample_sat
		FROM projects GROUP BY kind ORDER BY kind`)
	recentSettlements, _ := s.queryRows(ctx, `
		SELECT st.*, p.title FROM settlements st JOIN projects p ON p.id=st.project_id
		ORDER BY st.created_at DESC LIMIT 10`)
	writeJSON(w, 200, map[string]interface{}{
		"stats":              stats,
		"projects_by_kind":   byKind,
		"recent_settlements": recentSettlements,
	})
}
