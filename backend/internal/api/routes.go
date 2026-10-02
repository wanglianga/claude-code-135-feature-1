package api

import "net/http"

func (s *Server) routes() {
	m := s.Mux
	m.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})

	// 认证
	m.HandleFunc("/api/auth/register", s.handleRegister)
	m.HandleFunc("/api/auth/login", s.handleLogin)
	m.HandleFunc("/api/auth/me", s.requireAuth(s.handleMe))

	// 农场 / 地块 / 项目（公开读）
	m.HandleFunc("/api/farms", s.handleFarms)
	m.HandleFunc("/api/plots", s.handlePlots)
	m.HandleFunc("/api/plots/", s.requireAuth(s.handlePlotByID)) // /api/plots/{id} 与 /api/plots/{id}/ledger
	m.HandleFunc("/api/projects", s.optionalAuth(s.handleProjects))
	m.HandleFunc("/api/projects/", s.handleProjectByID) // /api/projects/{id} 及子资源

	// 认养
	m.HandleFunc("/api/adoptions", s.requireAuth(s.handleAdoptions))
	m.HandleFunc("/api/adoptions/", s.requireAuth(s.handleAdoptionByID))
	m.HandleFunc("/api/my/adoptions", s.requireAuth(s.handleMyAdoptions))

	// 工单 / 赔付 / 保险
	m.HandleFunc("/api/incidents", s.requireAuth(s.handleIncidents))
	m.HandleFunc("/api/incidents/", s.requireAuth(s.handleIncidentByID))
	m.HandleFunc("/api/compensations/", s.requireAuth(s.handleCompensationByID))
	m.HandleFunc("/api/insurance-claims", s.requireAuth(s.handleInsuranceClaims))
	m.HandleFunc("/api/insurance-claims/", s.requireAuth(s.handleInsuranceClaimByID))

	// 冰雹减产分配
	m.HandleFunc("/api/hail-allocations", s.requireAuth(s.handleHailAllocations))
	m.HandleFunc("/api/hail-allocations/", s.requireAuth(s.handleHailAllocationByID))
	m.HandleFunc("/api/hail-choices/", s.requireAuth(s.handleHailChoices))
	m.HandleFunc("/api/farm/renew-credit", s.requireAuth(s.handleRenewCredit))

	// 回访 / 证书 / 直播 / 参观 / 团购 / 公益
	m.HandleFunc("/api/callbacks", s.requireAuth(s.handleCallbacks))
	m.HandleFunc("/api/live", s.handleLive)
	m.HandleFunc("/api/live/", s.requireAuth(s.handleLiveByID))
	m.HandleFunc("/api/visits", s.requireAuth(s.handleVisits))
	m.HandleFunc("/api/visits/", s.requireAuth(s.handleVisitByID))
	m.HandleFunc("/api/group-buys", s.optionalAuth(s.handleGroupBuys))
	m.HandleFunc("/api/group-buys/", s.requireAuth(s.handleGroupBuyByID))
	m.HandleFunc("/api/charity", s.handleCharity)

	// 台账 / 看板 / 结算
	m.HandleFunc("/api/farm/dashboard", s.requireAuth(s.handleFarmDashboard))
	m.HandleFunc("/api/admin/overview", s.requireAuth(s.handleAdminOverview))
}
