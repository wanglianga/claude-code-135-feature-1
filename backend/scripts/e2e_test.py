#!/usr/bin/env python3
# 端到端 API 验证：覆盖认养付款/证书/农事/灾害/抽检/采摘/分拣/发货状态机/
# 改地址/坏果投诉/权益争议/多角色工单流水/赔付/保险/回访/直播/参观/团购/公益/台账/看板/结算
import json
import os
import sys
import urllib.request
import urllib.error

B = os.environ.get('FARMCROWD_BASE', 'http://127.0.0.1:8080')
results = []

def call(method, path, token=None, body=None):
    url = B + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

def check(name, cond, detail=""):
    results.append((name, cond, detail))
    print(("PASS" if cond else "FAIL") + ": " + name + ("" if cond else "  -> " + str(detail)[:200]))

def login(phone):
    st, r = call("POST", "/api/auth/login", body={"phone": phone, "password": "farm123"})
    assert st == 200, r
    return r["token"]

T = {
    "adopter":  login("13900000002"),  # 陈曦
    "adopter2": login("13900000008"),  # 吴琳
    "farmer":   login("13900000001"),  # 李远山
    "picker":   login("13900000003"),
    "packer":   login("13900000004"),
    "logistics":login("13900000005"),
    "service":  login("13900000006"),
    "admin":    login("13800000000"),
}
check("7 个角色全部登录成功", all(T.values()))

# ---- 公开浏览 ----
st, projs = call("GET", "/api/projects")
check("公开浏览 5 个认养项目", st == 200 and len(projs) == 5, len(projs))
st, p1 = call("GET", "/api/projects/1")
need_keys = {"project", "logs", "maturity_checks", "harvest_tasks", "sorting",
             "shipments", "incidents", "insurance_claims", "settlement"}
check("项目详情聚合全链路", need_keys.issubset(p1.keys()), p1.keys())
check("项目农事日志含冰雹", any("冰雹" in l.get("title", "") for l in p1["logs"]))
st, live = call("GET", "/api/live")
check("农场直播公开可见", any("红富士" in x["title"] for x in live))
st, charity = call("GET", "/api/charity")
check("公益认养公开榜", any("敬老院" in x["donee"] for x in charity))
st, _ = call("POST", "/api/adoptions", body={"project_id": 5})
check("未登录认养被拒", st == 401)

# ---- 认养付款（吴琳购买蔬菜 1 份，走全新订单）----
st, r = call("POST", "/api/adoptions", T["adopter2"], {
    "project_id": 5, "shares": 1, "recipient_name": "吴琳", "phone": "13900000008",
    "address": "杭州市西湖区文三路478号华星时代广场"})
check("付款成功并自动生成证书", st == 201 and r["cert_no"].startswith("CERT-VEG-2026-A"), r)
new_aid = r["adoption"]["id"]

st, r = call("POST", "/api/adoptions", T["adopter2"], {
    "project_id": 2, "shares": 999, "recipient_name": "x", "phone": "13900000000", "address": "x"})
check("超卖拦截", st == 409 and "不足" in r.get("error", ""), r)

# ---- 我的认养 · 权益公平兑现（陈曦苹果订单 id=1：保底40kg）----
st, mine = call("GET", "/api/my/adoptions", T["adopter"])
apple = next(a for a in mine if a["kind"] == "apple")
rf = apple["rights_fulfillment"]
print("   苹果权益核对:", rf)
check("保底量=40kg(20×2)", rf["guarantee_kg"] == 40, rf)
check("已发货 20kg（首批12+二批8计划）", rf["shipped_kg"] == 12 and rf["planned_kg"] == 8, rf)
# 补发39.9折1.33kg + 保险560折18.70kg；履约中已实现32kg，计入二批在途8kg后达40kg
check("履约中已实现尚不足(在途批次未发)", rf["fair"] is False, rf)
check("含在途批次后预计公平兑现=true", rf["projected_fair"] is True, rf)
check("赔付含保险560", rf["compensated_amount"] >= 599.9, rf)
check("证书号展示", apple["cert_no"] == "CERT-APPLE-2026-A-0001")
check("分批发货计划与冷链路线", len(apple["shipments"]) == 2 and "冷链车" in apple["shipments"][0]["cold_route"])
check("回访记录可见", len(apple["callbacks"]) == 1 and apple["callbacks"][0]["would_renew"])

# ---- 临时改地址（未发货可改，已发货拦截）----
st, r = call("POST", f"/api/adoptions/{new_aid}/address", T["adopter2"], {
    "recipient_name": "吴父", "phone": "13100000000", "address": "宁波市鄞州区首南街道9号",
    "reason": "出差改寄父母家"})
check("未发货订单改址成功并建工单", st == 200 and r["ok"] and r["incident_id"], r)
st, r = call("POST", "/api/adoptions/1/address", T["adopter"], {"address": "x路1号"})
check("已有发出批次改址被拦截", st == 409, r)

# ---- 农场端：灾害日志自动建工单 ----
st, r = call("POST", "/api/projects/5/logs", T["farmer"], {
    "log_type": "disaster", "title": "暖棚短时大风掀膜",
    "content": "连夜修补，叶菜延后3天上市", "disaster_kind": "大风", "yield_impact_pct": 5})
check("登记灾害农事日志", st == 201 and r["disaster_kind"] == "大风", r)
st, p5 = call("GET", "/api/projects/5")
check("大风灾害自动生成工单并入同一批次",
      any(i["kind"] in ("delay", "other", "hail") and "大风" in i["title"] for i in p5["incidents"]),
      p5["incidents"])

# ---- 成熟度抽检（糖度/分级/坏果率/预估产量）----
st, r = call("POST", "/api/projects/5/checks", T["farmer"], {
    "brix": 6.2, "sample_count": 20, "maturity_pct": 80, "est_yield_kg": 300,
    "bad_rate_pct": 1.2, "grade_dist": {"大": 50, "中": 40, "小": 10}, "notes": "叶菜达标"})
check("成熟度抽检登记", st == 201 and r["maturity_pct"] == 80 and r["grade_dist"]["大"] == 50, r)

# ---- 采摘安排（优先级）+ 采摘工回填 ----
st, r = call("POST", "/api/projects/5/harvests", T["farmer"], {
    "picker_id": 4, "priority": 10, "planned_date": "2026-10-16", "target_kg": 100})
check("农场安排采摘任务", st == 201, r)
hid = r["id"]
st, r = call("POST", f"/api/projects/5/harvests/{hid}/complete", T["picker"],
             {"actual_kg": 96, "bad_rate_pct": 2.1})
check("采摘工回填实际产量与坏果率", st == 200 and r["status"] == "done" and r["actual_kg"] == 96, r)
st, r = call("POST", f"/api/projects/5/harvests/{hid}/complete", T["adopter"],
             {"actual_kg": 1, "bad_rate_pct": 0})
check("非授权人员不能回填采摘", st == 403, r)

# ---- 分拣（包装规格）----
st, r = call("POST", "/api/projects/5/sorting", T["packer"],
             {"spec": "有机叶菜标准箱 8斤", "weight_kg": 96, "box_count": 24})
check("包装员登记分拣规格", st == 201 and r["box_count"] == 24, r)

# ---- 发货状态机 ----
st, r = call("POST", "/api/projects/5/shipments", T["farmer"], {
    "adoption_id": new_aid, "seq": 1, "plan_date": "2026-10-17",
    "pack_spec": "叶菜8斤箱", "cold_route": "烟台-杭州冷链", "weight_kg": 4})
check("编排序批发货计划", st == 201 and r["status"] == "planned", r)
sid = r["id"]
for st_ in ("picked", "packed"):
    st, r = call("POST", f"/api/projects/5/shipments/{sid}/advance", T["farmer"], {"status": st_})
    check(f"发货流转->{st_}", st == 200 and r["status"] == st_, r)
st, r = call("POST", f"/api/projects/5/shipments/{sid}/advance", T["logistics"],
             {"status": "shipped", "logistics_company": "顺丰冷运", "tracking_no": "SFVEG001",
              "bad_fruit_rate": 1.5})
check("物流发车填运单与坏果率", st == 200 and r["tracking_no"] == "SFVEG001", r)
st, r = call("POST", f"/api/projects/5/shipments/{sid}/advance", T["logistics"], {"status": "planned"})
check("非法状态跳转被拒", st == 400, r)
st, r = call("POST", f"/api/projects/5/shipments/{sid}/advance", T["logistics"], {"status": "delivered"})
check("物流确认送达", st == 200 and r["status"] == "delivered", r)
st, ad = call("GET", f"/api/adoptions/{new_aid}", T["adopter2"])
check("全部送达后订单自动完成", ad["status"] == "completed", ad)

# ---- 坏果投诉：多角色处理流水串到同一工单 ----
st, r = call("POST", "/api/incidents", T["adopter2"], {
    "project_id": 5, "adoption_id": new_aid, "kind": "bad_fruit",
    "title": "蔬菜箱有两株压伤", "description": "开箱发现最下层两株油麦菜压伤"})
check("认养人提交坏果工单", st == 201, r)
iid_new = r["id"]
st, _ = call("POST", f"/api/incidents/{iid_new}/events", T["logistics"],
             {"action": "提供冷链温控记录", "note": "全程2-6℃，无脱冷"})
st, _ = call("POST", f"/api/incidents/{iid_new}/events", T["packer"],
             {"action": "包装复查", "note": "叶菜筐底部缓冲不足，加垫泡沫垫"})
st, _ = call("POST", f"/api/incidents/{iid_new}/events", T["farmer"],
             {"action": "同意补发", "note": "下批补发同价叶菜"})
st, _ = call("POST", f"/api/compensations/incident/{iid_new}", T["service"],
             {"amount": 8, "kind": "reship", "note": "补发油麦菜折值8元"})
st, detail = call("GET", f"/api/incidents/{iid_new}", T["service"])
roles = {e["actor_role"] for e in detail["events"]}
check("工单串联 认养人/物流/包装/农场/客服", {"adopter", "logistics", "packer", "farmer", "service"} <= roles, roles)
check("赔付后工单自动转 compensated", detail["incident"]["status"] == "compensated", detail["incident"])

# ---- 既有工单：坏果单 id=2 追加客服事件并解决 ----
st, r = call("POST", "/api/incidents/2/events", T["service"],
             {"action": "二次回访", "note": "客户满意", "status": "resolved"})
check("客服推进工单状态", st == 201 and r["action"] == "二次回访", r)
st, detail2 = call("GET", "/api/incidents/2", T["adopter"])
check("认养人可查看本批次完整处理流水", len(detail2["events"]) >= 6 and detail2["incident"]["status"] == "resolved")

# ---- 保险理赔：新建报案并推进到到账 ----
st, r = call("POST", "/api/insurance-claims", T["farmer"], {
    "project_id": 5, "policy_no": "PICC-WIND-2026-009", "kind": "大风",
    "loss_kg": 30, "amount": 600, "note": "大风掀膜损失"})
check("农场保险报案", st == 201 and r["status"] == "applied", r)
claim_id = r["id"]
for st_ in ("surveying", "approved", "settled"):
    st, r = call("POST", f"/api/insurance-claims/{claim_id}", T["service"], {"status": st_})
check("理赔推进到到账", st == 200 and r["status"] == "settled", r)

# ---- 回访（含下一季续认建议）----
st, r = call("POST", "/api/callbacks", T["adopter2"], {
    "adoption_id": new_aid, "satisfaction": 5, "quality_score": 5, "delivery_score": 4,
    "would_renew": True, "comment": "蔬菜新鲜、处理问题很快", "renew_suggestion": "希望增加水果胡萝卜"})
check("成熟度回访+续认建议", st == 201 and r["satisfaction"] == 5, r)
st, r = call("POST", "/api/callbacks", T["adopter2"], {
    "adoption_id": new_aid, "satisfaction": 9, "quality_score": 5, "delivery_score": 4})
check("回访评分越界被拒", st == 400, r)

# ---- 直播 / 参观 / 团购 ----
st, r = call("POST", "/api/projects/1/live", T["farmer"], {
    "title": "分拣车间夜场直播", "stream_url": "https://live.example.com/sort",
    "starts_at": "2026-10-21T19:00:00+08:00"})
check("农场创建直播", st == 201 and r["status"] == "scheduled", r)
live_id = r["id"]
st, r = call("POST", f"/api/live/{live_id}", T["farmer"], {"status": "live"})
check("开播状态流转", st == 200 and r["status"] == "live", r)
st, r = call("POST", "/api/visits", T["adopter"], {
    "plot_id": 2, "visit_date": "2026-11-01", "visitors": 2, "note": "蓝莓园参观"})
check("地块参观预约", st == 201 and r["status"] == "pending", r)
vid = r["id"]
st, r = call("POST", f"/api/visits/{vid}", T["farmer"], {"status": "approved", "note": "欢迎，安排午餐"})
check("农场审核参观预约", st == 200 and r["status"] == "approved", r)
st, r = call("POST", "/api/group-buys", T["adopter"], {
    "project_id": 4, "company_name": "明德教育集团", "contact": "刘老师",
    "phone": "13900000009", "shares": 80, "discount_pct": 12})
check("企业团购需求提交", st == 201 and r["status"] == "pending", r)
gbid = r["id"]
st, r = call("POST", f"/api/group-buys/{gbid}", T["farmer"], {"status": "confirmed"})
check("农场确认团购", st == 200 and r["status"] == "confirmed", r)

# ---- 公益认养下单（代捐）----
st, r = call("POST", "/api/adoptions", T["adopter"], {
    "project_id": 4, "shares": 2, "recipient_name": "西山敬老院", "phone": "13900000010",
    "address": "栖霞市西山镇敬老院", "is_charity": True, "donee": "西山敬老院",
    "message": "祝老人们秋收安康"})
check("公益代捐认养成功", st == 201 and r["cert_no"], r)
st, ch = call("GET", "/api/charity")
check("公益榜新增受益方记录", any(x["donee"] == "西山敬老院" for x in ch))

# ---- 地块完整账 ----
st, led = call("GET", "/api/plots/1/ledger", T["farmer"])
check("地块台账聚合完整链路",
      all(k in led for k in ["costs", "logs", "disasters", "maturity_checks",
                             "harvest_tasks", "sorting", "shipments", "incidents",
                             "compensations", "callbacks"]), led.keys())
check("地块成本台账>0", led["total_cost"] > 0, led["total_cost"])
check("地块台账含冰雹灾害", any(d.get("disaster_kind") == "冰雹" for d in led["disasters"]))
check("地块台账含赔付与回访", len(led["compensations"]) >= 2 and len(led["callbacks"]) >= 1)
check("地块平均满意度计算", led["avg_satisfaction"] >= 4, led["avg_satisfaction"])

# ---- 农场看板 / 平台总览 ----
st, dash = call("GET", "/api/farm/dashboard", T["farmer"])
check("农场看板含项目/地块/工单/发货",
      all(k in dash for k in ["projects", "plots", "open_incidents", "active_shipments", "stats"]))
check("看板统计销售额", dash["stats"]["total_sales"] > 0, dash["stats"])
st, r = call("GET", "/api/admin/overview", T["adopter"])
check("非管理员禁止平台总览", st == 403)
st, ov = call("GET", "/api/admin/overview", T["admin"])
check("平台总览含分类项目与结算", "projects_by_kind" in ov and "recent_settlements" in ov, ov.keys())
check("平台总览含公益份额/保险到账/团购数",
      ov["stats"]["charity_shares"] >= 12 and ov["stats"]["insurance_settled"] >= 6000, ov["stats"])

# ---- 最终结算（蔬菜季，沉淀产量/成本/满意度/续认率）----
st, r = call("POST", "/api/projects/5/settle", T["farmer"],
             {"summary": "蔬菜季按时交付，坏果投诉快速闭环，客户满意，建议下季增水果胡萝卜。"})
check("生成最终交付结算", st == 200 and r["settlement"]["total_yield_kg"] == 96, r)
check("结算含赔付与满意度", r["settlement"]["total_compensation"] >= 8 and r["settlement"]["avg_satisfaction"] == 5,
      r["settlement"])
st, p5b = call("GET", "/api/projects/5")
check("结算后项目标记完成", p5b["project"]["status"] == "completed", p5b["project"]["status"])

# ---- 冰雹减产分配（种子故事线）----
st, al = call("GET", "/api/hail-allocations", T["farmer"])
check("分配方案列表", st == 200 and len(al) >= 1, len(al))
st, d1 = call("GET", "/api/hail-allocations/1", T["service"])
seed_choices = {c["option"]: c for c in d1["choices"]}
check("种子方案含3笔选择(延期/换品类/退款)",
      {"delay", "switch", "refund"} <= set(seed_choices), seed_choices.keys())
sw = seed_choices["switch"]
check("换品类客服已确认+批次已重确认",
      sw["service_status"] == "confirmed" and sw["batch_status"] == "confirmed", sw)
check("退款金额≈718.80(10份×599×12%)",
      abs(seed_choices["refund"]["refund_amount"] - 718.8) < 0.01, seed_choices["refund"])
check("农场续认信用 104 分 B 级",
      d1["renew_credit"]["score"] == 104 and d1["renew_credit"]["level"] == "B", d1["renew_credit"])
check("信用分项：延期2/换品类20/退款10",
      (d1["renew_credit"]["delayed_shares"], d1["renew_credit"]["switched_shares"],
       d1["renew_credit"]["refunded_shares"]) == (2, 20, 10), d1["renew_credit"])

st, mine0 = call("GET", "/api/my/adoptions", T["adopter"])
ap = next(a for a in mine0 if a["kind"] == "apple")
check("认养人侧看到分配方案与本人选择",
      ap["hail_allocation"]["id"] == 1 and ap["hail_choice"]["option"] == "delay", ap.get("hail_choice"))
check("证书换发第2版并带换发说明", ap["cert_version"] == 2 and "延期" in ap["cert_reissue_note"],
      (ap["cert_version"], ap.get("cert_reissue_note")))
check("预计到货时间更新为2026-11-05", str(ap["eta_date"]).startswith("2026-11-05"), ap["eta_date"])
st, p1b = call("GET", "/api/projects/1")
check("项目详情聚合减产分配", len(p1b["hail_allocations"]) >= 1, p1b.keys())
st, dashb = call("GET", "/api/farm/dashboard", T["farmer"])
check("农场看板含续认信用与分配进度",
      len(dashb["renew_credits"]) >= 1 and len(dashb["hail_allocations"]) >= 1, dashb.keys())
st, ov2 = call("GET", "/api/admin/overview", T["admin"])
check("平台总览含分配数与信用榜",
      ov2["stats"]["hail_allocations"] >= 1 and len(ov2["renew_credits"]) >= 1, ov2["stats"])
st, inc1 = call("GET", "/api/incidents/1", T["adopter"])
check("冰雹工单含换品类客服确认与批次重确认流水",
      any("客服确认换品类" in e["action"] for e in inc1["events"])
      and any("重新确认换品类配送批次" in e["action"] for e in inc1["events"]),
      [e["action"] for e in inc1["events"]])

# ---- 冰雹减产分配（全新全流程：蜂蜜项目，换品类→客服→批次→确认；再退款一次）----
st, r = call("POST", "/api/auth/register", body={
    "name": "测试认养人小赵", "phone": "13900009999", "password": "farm123", "role": "adopter"})
check("注册新认养人", st == 201, r)
T["adopter3"] = login("13900009999")
st, r = call("POST", "/api/adoptions", T["adopter3"], {
    "project_id": 3, "shares": 1, "recipient_name": "赵测试", "phone": "13900009999",
    "address": "成都市武侯区测试路1号"})
check("蜂蜜认养下单", st == 201 and r["cert_no"].startswith("CERT-HONEY-2026-A"), r)
honey_aid = r["adoption"]["id"]

st, r = call("POST", "/api/hail-allocations", T["adopter3"], {"project_id": 3, "title": "x", "pickable_kg": 3})
check("认养人不能创建分配方案", st == 403, r)
st, r = call("POST", "/api/hail-allocations", T["farmer"], {
    "project_id": 3, "title": "洋槐蜜花期遇冰雹减产分配", "pickable_kg": 3,
    "photos": [{"caption": "受灾蜂箱", "url": "/static/demo/honey-hail.jpg"}],
    "delay_option": {"eta_date": "2026-06-30", "note": "延后取蜜", "bonus_kg": 0.5},
    "switch_option": [{"kind": "blueberry", "title": "蓝莓鲜果2斤装", "kg_equiv": 1, "eta_date": "2026-07-05"}],
    "compensation_plan": "延期/换蓝莓/按比例退款三选一"})
check("农场记录蜂蜜减产方案（承诺4kg、可采3kg→退款25%）",
      st == 201 and r["committed_kg"] == 4 and r["refund_pct"] == 25, r)
hail2 = r["id"]
st, d2 = call("GET", f"/api/hail-allocations/{hail2}", T["adopter3"])
check("认养人查看本人项目方案", st == 200 and len(d2["choices"]) == 0, st)
st, _ = call("GET", f"/api/hail-allocations/{hail2}", T["adopter"])
check("非本项目认养人不能查看方案", st == 403)

st, r = call("POST", f"/api/hail-allocations/{hail2}/choose", T["adopter3"], {
    "adoption_id": honey_aid, "option": "switch", "switch_kind": "blueberry",
    "switch_title": "蓝莓鲜果2斤装", "switch_kg": 1, "eta_date": "2026-07-05"})
check("认养人选择换品类(待客服+待批次)",
      st == 201 and r["service_status"] == "pending" and r["batch_status"] == "pending", r)
choice_id = r["id"]
st, r = call("POST", f"/api/hail-allocations/{hail2}/confirm", T["farmer"], {})
check("客服未确认时禁止最终确认", st == 409 and "客服" in r["error"], r)
st, r = call("POST", f"/api/hail-choices/{choice_id}/service", T["farmer"], {"status": "confirmed"})
check("农场不能代替客服确认换品类", st == 403, r)
st, r = call("POST", f"/api/hail-choices/{choice_id}/batch", T["adopter3"],
             {"batch_plan": {"plan_date": "2026-07-05"}})
check("客服确认前不能确认配送批次", st == 409, r)
st, r = call("POST", f"/api/hail-choices/{choice_id}/service", T["service"], {"status": "confirmed"})
check("客服确认换品类", st == 200 and r["service_status"] == "confirmed", r)
st, r = call("POST", f"/api/hail-allocations/{hail2}/confirm", T["farmer"], {})
check("批次未重确认时禁止最终确认", st == 409 and "配送批次" in r["error"], r)
st, r = call("POST", f"/api/hail-choices/{choice_id}/batch", T["adopter"],
             {"batch_plan": {"plan_date": "2026-07-05"}})
check("他人不能确认配送批次", st == 403, r)
st, r = call("POST", f"/api/hail-choices/{choice_id}/batch", T["adopter3"], {
    "batch_plan": {"seq": 1, "plan_date": "2026-07-05",
                   "pack_spec": "【换品类】蓝莓鲜果2斤装", "cold_route": "烟台-成都生鲜空运", "weight_kg": 1}})
check("认养人重新确认配送批次并生成运单计划",
      st == 200 and r["batch_status"] == "confirmed" and r["batch_plan"]["shipment_id"], r)
st, r = call("POST", f"/api/hail-allocations/{hail2}/confirm", T["farmer"], {})
# 续认信用按农场当季累计：种子104 + 处置2 + 换品类1份 = 107（B）
check("农场确认减产分配（换品类1份→信用累计107 B）",
      st == 200 and r["renew_credit"]["score"] == 107 and r["renew_credit"]["level"] == "B", r)
st, mine2 = call("GET", "/api/my/adoptions", T["adopter3"])
ho = next(a for a in mine2 if a["id"] == honey_aid)
check("换品类确认后证书+ETA+新批次",
      ho["cert_version"] >= 1 and "换为" in ho["cert_reissue_note"]
      and str(ho["eta_date"]).startswith("2026-07-05")
      and any("换品类" in s["pack_spec"] for s in ho["shipments"]),
      (ho.get("cert_reissue_note"), ho.get("eta_date")))
st, r = call("POST", f"/api/hail-allocations/{hail2}/confirm", T["farmer"], {})
check("重复确认被拒", st == 409, r)

# 第二个方案：退款路径 + 理赔状态同步
st, r = call("POST", "/api/adoptions", T["adopter2"], {
    "project_id": 3, "shares": 2, "recipient_name": "吴琳", "phone": "13900000008",
    "address": "杭州市西湖区文三路478号"})
check("吴琳蜂蜜认养2份", st == 201, r)
honey2_aid = r["adoption"]["id"]
st, r = call("POST", "/api/incidents", T["farmer"], {
    "project_id": 3, "kind": "hail", "title": "洋槐蜜花期冰雹工单",
    "description": "用于跟踪理赔状态同步"})
check("创建蜂蜜冰雹工单", st == 201 and r["kind"] == "hail", r)
honey_inc = r["id"]
st, r = call("POST", "/api/hail-allocations", T["farmer"], {
    "project_id": 3, "incident_id": honey_inc, "title": "洋槐蜜二次分配（退款）",
    "pickable_kg": 3, "refund_pct": 25, "target_adoption_ids": [honey2_aid],
    "delay_option": {"eta_date": "2026-07-10"}, "switch_option": [],
    "compensation_plan": "建议按25%退款"})
check("创建第二个分配方案并关联冰雹工单（限定适用订单）",
      st == 201 and r["incident_id"] == honey_inc and r["target_adoption_ids"] == [honey2_aid], r)
hail3 = r["id"]
# 非适用订单（honey_aid 已在 hail2 处理）不能在本方案选择
st, r = call("POST", f"/api/hail-allocations/{hail3}/choose", T["adopter3"], {
    "adoption_id": honey_aid, "option": "delay", "eta_date": "2026-07-10"})
check("非适用订单不能在本方案选择", st == 400, r)
st, r = call("POST", f"/api/hail-allocations/{hail3}/choose", T["adopter2"], {
    "adoption_id": honey2_aid, "option": "refund"})
check("吴琳选择按比例退款(2份×399×25%=199.5)",
      st == 201 and r["refund_pct"] == 25 and r["refund_amount"] == 199.5, r)
st, r = call("POST", "/api/insurance-claims", T["farmer"], {
    "project_id": 3, "policy_no": "PICC-HONEY-2026-01", "kind": "冰雹",
    "loss_kg": 4, "amount": 800, "note": "花期冰雹"})
check("蜂蜜保险报案", st == 201, r)
claim2 = r["id"]
st, r = call("POST", f"/api/insurance-claims/{claim2}", T["service"], {"status": "surveying"})
check("理赔查勘状态推进", st == 200 and r["status"] == "surveying", r)
st, inc3 = call("GET", f"/api/incidents/{honey_inc}", T["adopter2"])
check("理赔状态同步认养人(工单流水留痕)",
      any(e["action"] == "理赔状态同步认养人" for e in inc3["events"]),
      [e["action"] for e in inc3["events"]])
st, r = call("POST", f"/api/hail-allocations/{hail3}/confirm", T["service"], {})
check("客服可代为确认分配（退款出账+信用累计）", st == 200, r)
# 累计：种子104 → +处置2+换品类1=107 → +处置2-退款4=105；当季处置3次、退款累计12份
check("续认信用累计为105(B)且记录退款12份/处置3次",
      r["renew_credit"]["score"] == 105 and r["renew_credit"]["refunded_shares"] == 12
      and r["renew_credit"]["hail_handled"] == 3, r["renew_credit"])
st, comps = call("GET", f"/api/incidents/{honey_inc}", T["farmer"])
check("退款自动生成现金赔付记录",
      any(c["kind"] == "cash" and abs(c["amount"] - 199.5) < 0.01 and c["status"] == "paid"
          for c in comps["compensations"]), comps["compensations"])
st, mine3 = call("GET", "/api/my/adoptions", T["adopter2"])
ho2 = next(a for a in mine3 if a["id"] == honey2_aid)
check("退款订单证书换发说明含退款金额",
      ho2["cert_version"] >= 1 and "199.50" in (ho2["cert_reissue_note"] or ""),
      ho2.get("cert_reissue_note"))
st, r = call("GET", "/api/farm/renew-credit", T["service"])
check("续认信用接口可查", st == 200 and any(x["farm_id"] == 1 and x["score"] == 105 for x in r), r)

# ---- 权限边界 ----
st, r = call("POST", "/api/projects", T["adopter"], {"plot_id": 1, "batch_no": "X", "kind": "apple",
                                                     "title": "x", "price_per_share": 1})
check("认养人不能发布项目", st == 403)
st, r = call("POST", "/api/projects/1/checks", T["logistics"], {"maturity_pct": 1})
check("非农场人员不能登记抽检(应403)", st == 403, r)

passed = sum(1 for _, c, _ in results if c)
print(f"\n==== {passed}/{len(results)} 通过 ====")
sys.exit(0 if passed == len(results) else 1)
