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
    "adopter3": login("13900000007"),  # 周凯（企业认养人，也用于换品类）
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
check("公开浏览认养项目（含冰雹换购晚秋蓝莓）", st == 200 and len(projs) == 6, len(projs))
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
check("证书号展示（冰雹延期后已换发第2版）", apple["cert_no"] == "CERT-APPLE-2026-A-0001-R2" and apple["cert_version"] == 2,
      (apple["cert_no"], apple["cert_version"]))
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

# ======================================================================
# 冰雹减产分配全流程：登记(照片/保险/可采果/三选一) → 发布 → 认养人三选一
#   延期(证书换发+ETA) / 退款(按比例) / 换品类(客服确认→批次再确认→证书换发)
#   → 理赔状态同步认养人 → 关闭并同步农场续认信用
# ======================================================================
# 吴琳先认养水稻 1 份，保证发布时她有待选择订单
st, r = call("POST", "/api/adoptions", T["adopter2"], {
    "project_id": 4, "shares": 1, "recipient_name": "吴琳", "phone": "13900000008",
    "address": "杭州市西湖区文三路478号华星时代广场"})
check("吴琳认养水稻 1 份", st == 201 and r["cert_no"], r)
rice_aid_w = r["adoption"]["id"]

# 周凯再认养水稻 1 份，用于换品类三选一
st, r = call("POST", "/api/adoptions", T["adopter3"], {
    "project_id": 4, "shares": 1, "recipient_name": "周凯", "phone": "13900000007",
    "address": "上海市浦东新区张江高科技园区博云路2号"})
check("周凯认养水稻 1 份", st == 201 and r["cert_no"], r)
rice_aid_z = r["adoption"]["id"]

# 农场记冰雹灾害（自动建冰雹工单，受灾照片归档在灾害日志）
st, r = call("POST", "/api/projects/4/logs", T["farmer"], {
    "log_type": "disaster", "title": "稻田灌浆期突降冰雹",
    "content": "部分稻穗被压伏，套作区受灾，已拍照并准备报案。",
    "disaster_kind": "冰雹", "yield_impact_pct": 10,
    "photos": [{"caption": "倒伏稻穗", "url": "/static/demo/rice-hail.jpg"}]})
check("登记水稻冰雹灾害(含受灾照片)", st == 201, r)
st, p4 = call("GET", "/api/projects/4")
rice_inc = max(i["id"] for i in p4["incidents"] if i["kind"] == "hail")

# 登记减产分配（一并保险报案）
st, r = call("POST", "/api/hail-allocations", T["adopter"],
             {"incident_id": rice_inc, "pickable_kg": 4000})
check("认养人不能登记减产分配", st == 403, r)
st, r = call("POST", "/api/hail-allocations", T["farmer"], {
    "incident_id": rice_inc, "pickable_kg": 4000,
    "insurance_policy_no": "PICC-HAIL-2026-RICE-7",
    "insurance_loss_kg": 240, "insurance_amount": 3600,
    "plan_delay": "未碾新米顺延至11月15日前到货，缺口保险折算补偿。",
    "plan_swap": "等值换购本农场晚秋蓝莓，客服确认后排批次。",
    "plan_refund": "按保底缺口比例原路退款。", "new_eta_date": "2026-11-15"})
check("农场登记减产分配并自动报案", st == 201 and r["shortage_kg"] > 0 and r["insurance_claim_id"], r)
alc_id = r["id"]
promised, pickable, shortage = r["promised_kg"], r["pickable_kg"], r["shortage_kg"]
st, r = call("POST", "/api/hail-allocations", T["farmer"],
             {"incident_id": rice_inc, "pickable_kg": 4000})
check("重复登记被拦截", st == 409, r)

# 认养人在方案发布前不能选择
st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["adopter2"],
             {"option": "refund", "adoption_id": rice_aid_w})
check("方案发布前选择被拦截", st == 409, r)

# 客服发布三选一
st, r = call("POST", f"/api/hail-allocations/{alc_id}/publish", T["adopter"], {})
check("认养人不能发布方案", st == 403, r)
st, r = call("POST", f"/api/hail-allocations/{alc_id}/publish", T["service"], {})
check("客服发布三选一并为每单生成待选择记录",
      st == 200 and r["ok"] and r["published_choices"] >= 2, r)
st, detail = call("GET", f"/api/hail-allocations/{alc_id}", T["service"])
ch_by_adopt = {c["adoption_id"]: c for c in detail["choices"]}
check("吴琳水稻订单存在待选择记录",
      rice_aid_w in ch_by_adopt and ch_by_adopt[rice_aid_w]["status"] == "pending", ch_by_adopt.keys())
ch_w = ch_by_adopt[rice_aid_w]["id"]
# 陈曦的水稻订单（种子 id=6）
rice_aid_c = next(a for a in ch_by_adopt if ch_by_adopt[a]["user_name"].startswith("陈曦"))
ch_c = ch_by_adopt[rice_aid_c]["id"]

# 不能为他人订单选择
st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["adopter"],
             {"option": "refund", "adoption_id": rice_aid_w})
check("不能代他人订单选择", st == 403, r)
# 关闭前不能关闭（有待确认）
st, r = call("POST", f"/api/hail-allocations/{alc_id}/close", T["service"], {})
check("未全部确认不能关闭", st == 409, r)

# 吴琳：按比例退款（自动生成现金赔付 + 证书换发）
st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["adopter2"],
             {"option": "refund", "adoption_id": rice_aid_w})
check("吴琳选择按比例退款", st == 200 and r["status"] == "confirmed" and r["refund_amount"] > 0, r)
expect_refund = round(269.0 * shortage / promised, 2)
check("退款额=订单金额×缺口比例", abs(r["refund_amount"] - expect_refund) < 0.01, (r["refund_amount"], expect_refund))
st, mine_w = call("GET", "/api/my/adoptions", T["adopter2"])
rw = next(a for a in mine_w if a["id"] == rice_aid_w)
check("退款订单证书已换发(版本2/编号-R2)", rw["cert_version"] == 2 and rw["cert_no"].endswith("-R2"),
      (rw["cert_no"], rw["cert_version"]))
check("退款订单可见按比例退款赔付",
      any(c["kind"] == "cash" and abs(c["amount"] - expect_refund) < 0.01 for c in rw["compensations"]),
      rw["compensations"])
st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["adopter2"],
             {"option": "delay", "adoption_id": rice_aid_w})
check("已确认选择不能重复提交", st == 409, r)

# 陈曦：延期（证书换发 + 未发批次 ETA 更新）
st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["adopter"],
             {"option": "delay", "adoption_id": rice_aid_c, "eta_date": "2026-11-15"})
check("陈曦选择延期交付", st == 200 and r["eta_date"].startswith("2026-11-15"), r)
st, mine_c = call("GET", "/api/my/adoptions", T["adopter"])
rc = next(a for a in mine_c if a["id"] == rice_aid_c)
check("延期订单证书已(换)签发且注明延期原因",
      rc["cert_no"] and "延期" in (rc["cert_reissue_reason"] or ""),
      (rc["cert_no"], rc["cert_reissue_reason"]))
check("延期后预计到货时间更新", rc["latest_eta_date"] == "2026-11-15", rc["latest_eta_date"])

# 周凯：换品类（水稻→晚秋蓝莓），客服确认后重新确认配送批次
st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["adopter3"], {
    "option": "swap", "adoption_id": rice_aid_z, "swap_project_id": 6})
check("周凯选择换品类(水稻→晚秋蓝莓)", st == 200 and r["option"] == "swap" and r["swap_project_id"] == 6, r)
swap_choice_id = r["id"]
# 客服确认前不能确认配送批次
st, r = call("POST", f"/api/hail-choices/{swap_choice_id}/batch", T["adopter3"],
             {"batch_plan_date": "2026-11-18", "batch_eta_date": "2026-11-20"})
check("客服确认前不能确认换购批次", st == 409, r)
# 客服确认换品类（结果同步客服、预排换购运单）
st, r = call("POST", f"/api/hail-choices/{swap_choice_id}/service", T["adopter3"], {})
check("非客服不能确认换品类", st == 403, r)
st, r = call("POST", f"/api/hail-choices/{swap_choice_id}/service", T["service"], {
    "action": "confirm", "batch_seq": 1, "batch_plan_date": "2026-11-18",
    "batch_eta_date": "2026-11-20", "batch_spec": "晚秋蓝莓礼盒（换购批次，顺丰生鲜冷链）",
    "note": "换品类等值兑换已确认，结果同步客服。"})
check("客服确认换品类", st == 200 and r["service_status"] == "confirmed", r)
# 认养人重新确认配送批次 → 证书换发 + ETA
st, r = call("POST", f"/api/hail-choices/{swap_choice_id}/batch", T["adopter3"], {
    "batch_seq": 1, "batch_plan_date": "2026-11-18", "batch_eta_date": "2026-11-20",
    "batch_spec": "晚秋蓝莓礼盒（换购批次，顺丰生鲜冷链）"})
check("认养人重新确认换购配送批次", st == 200 and r["batch_status"] == "confirmed", r)
st, mine_z = call("GET", "/api/my/adoptions", T["adopter3"])
rs = next(a for a in mine_z if a["id"] == rice_aid_z)
check("换品类订单换发证书(第2版)并指向换购批次",
      rs["cert_version"] == 2 and len(rs.get("swap_shipments", [])) >= 1,
      (rs["cert_no"], rs.get("swap_shipments")))
check("换购批次到货时间可见", rs["latest_eta_date"] == "2026-11-20", rs["latest_eta_date"])

# 理赔状态同步认养人：推进报案到各状态，冰雹工单流水出现“保险理赔状态同步认养人”
rice_claim = detail["allocation"]["insurance_claim_id"]
for st_ in ("surveying", "approved", "settled"):
    st, r = call("POST", f"/api/insurance-claims/{rice_claim}", T["service"], {"status": st_})
check("水稻理赔推进到到账", st == 200 and r["status"] == "settled", r)
st, idetail = call("GET", f"/api/incidents/{rice_inc}", T["adopter"])
sync_events = [e for e in idetail["events"] if e["action"] == "保险理赔状态同步认养人"]
check("理赔状态变化同步到冰雹工单(认养人可见)", len(sync_events) >= 3, len(sync_events))
check("工单详情含冰雹减产分配", len(idetail["hail_allocations"]) >= 1, idetail.keys())

# 关闭分配前，客服/管理员代剩余待选择订单（如公益代捐份额）兜底选择延期
st, detail = call("GET", f"/api/hail-allocations/{alc_id}", T["service"])
remaining = [c for c in detail["choices"] if c["status"] != "confirmed"]
for c in remaining:
    st, r = call("POST", f"/api/hail-allocations/{alc_id}/choices", T["service"],
                 {"adoption_id": c["adoption_id"], "option": "delay", "eta_date": "2026-11-15"})
    check(f"客服代剩余订单#{c['adoption_id']}兜底选择延期", st == 200 and r["status"] == "confirmed", r)

# 关闭分配，农场续认信用同步
st, before = call("GET", "/api/farm/dashboard", T["farmer"])
credit_before = before["stats"]["renew_credit"]
st, r = call("POST", f"/api/hail-allocations/{alc_id}/close", T["service"], {})
check("全部确认后关闭分配并同步续认信用", st == 200 and r["ok"], r)
st, after = call("GET", "/api/farm/dashboard", T["farmer"])
credit_after = after["stats"]["renew_credit"]
check("农场续认信用随减产分配下降", credit_after < credit_before, (credit_before, credit_after))
st, detail2 = call("GET", f"/api/hail-allocations/{alc_id}", T["service"])
check("分配单状态为 closed", detail2["allocation"]["status"] == "closed", detail2["allocation"]["status"])
st, r = call("POST", f"/api/hail-allocations/{alc_id}/close", T["service"], {})
check("重复关闭被拦截", st == 409, r)

# ---- 权限边界 ----
st, r = call("POST", "/api/projects", T["adopter"], {"plot_id": 1, "batch_no": "X", "kind": "apple",
                                                     "title": "x", "price_per_share": 1})
check("认养人不能发布项目", st == 403)
st, r = call("POST", "/api/projects/1/checks", T["logistics"], {"maturity_pct": 1})
check("非农场人员不能登记抽检(应403)", st == 403, r)

passed = sum(1 for _, c, _ in results if c)
print(f"\n==== {passed}/{len(results)} 通过 ====")
sys.exit(0 if passed == len(results) else 1)
