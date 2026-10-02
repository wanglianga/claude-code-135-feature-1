# 🌱 谷香认养 · 农产品众筹认养配送与成熟度回访平台

围绕"同一认养批次"把 **农场、认养人、采摘工、包装员、物流、客服** 的全部处理结果串成一条链：
地块 → 农事投入 → 施肥用药 → 天气灾害 → 成熟度抽检 → 采摘 → 分拣 → 分批发货（冷链）→
坏果/争议/赔付 → 保险理赔 → 成熟度回访 → 最终交付结算 → 地块成本与客户满意度沉淀。

技术栈：**React 18（Vite）+ Go 1.19（net/http + pgx）+ PostgreSQL 15**，单镜像部署、`docker compose` 一键启动。

---

## 一、一键启动（Docker Compose，推荐）

前置：已安装 Docker 与 Docker Compose。

```bash
cd /workspace/135-feature-1-b
docker compose up --build -d
```

启动后访问：

- 平台首页（认养项目）：<http://localhost:8080>
- 健康检查：<http://localhost:8080/api/health>

服务说明：

| 服务 | 内容 | 端口 |
|---|---|---|
| `app` | Go 后端 API + 托管 React 构建产物（单端口同源） | 8080 |
| `db`  | PostgreSQL 15，库名 `farmcrowd`，用户/密码 `farm/farm123` | 5432 |

首次启动时后端会自动执行数据库迁移并写入演示数据（含冰雹减产、坏果投诉、临时改地址、
企业团购权益口径争议等完整场景），无需手工初始化。停止用 `docker compose down`，
清除数据卷用 `docker compose down -v`。

---

## 二、演示账号（密码均为 `farm123`）

| 角色 | 姓名 | 手机号 | 登录后主要视图 |
|---|---|---|---|
| 平台管理员 | 平台管理员 | `13800000000` | 平台运营总览、品类与结季数据沉淀 |
| 农场主 | 李远山 | `13900000001` | 农场工作台、地块完整账、发布项目/农事/采摘/发货/结算 |
| 认养人 | 陈曦 | `13900000002` | 我的认养、权益兑现核对、证书、改地址、回访 |
| 认养人（企业） | 周凯 | `13900000007` | 星辰科技 20 棵企业团购订单 |
| 认养人 | 吴琳 | `13900000008` | 可用于下一笔全新认养全流程体验 |
| 采摘工 | 赵秀兰 | `13900000003` | 回填采摘实际产量与坏果率 |
| 包装员 | 王梅 | `13900000004` | 登记分拣与包装规格 |
| 冷链物流 | 马建国 | `13900000005` | 推进发货状态（采摘→包装→发车→送达） |
| 客服 | 孙悦 | `13900000006` | 工单协调、赔付登记、回访 |

登录页点击任意演示账号即可自动填充手机号。

---

## 三、推荐验证路径（对应题目要求）

1. **不登录**浏览首页 5 个认养项目（🍎苹果 / 🫐蓝莓 / 🍯蜂蜜 / 🌾稻田 / 🥬蔬菜）与"直播·公益·团购"。
2. 用 **认养人陈曦 `13900000002`** 登录"我的认养"：
   - 苹果订单可看到 **保底 40kg、分两批发货、冷链路线、认养证书（冰雹后第 2 版）**；
   - "权益兑现"区展示已收到 / 在途 / 赔付折算，冰雹保险赔付+补发按金额折回产量，
     区分"已公平兑现"与"含在途批次的预计兑现"；
   - 🧊 **冰雹减产分配**区可查看受灾照片、保险理赔状态、可采果数量与三选一补偿方案，
     陈曦的选择为"延期"，预计到货更新为 2026-11-05；
   - 可查看坏果投诉工单中 6 个角色的完整处理流水。
3. 用 **农场主 `13900000001`** 登录"农场工作台" → 点击"东坡3号苹果园"查看**地块完整账**：
   六类成本、冰雹灾害、成熟度抽检、采摘、分拣、发货、赔付、回访一页到底；工作台另含
   **🧊 冰雹减产分配进度**与 **⭐ 农场续认信用（104 分 / B 级）**。
4. 在任一进行中项目页用农场操作栏走一遍：**记灾害（自动建工单）→ 成熟度抽检 → 安排采摘 →
   采摘工账号回填 → 包装员分拣 → 编批发货 → 物流发车/送达 → 季末结算**；
   在"🧊减产分配"页可**记录分配方案（照片/保险报案/可采果量/三选一）→ 认养人选择 →
   （换品类）客服确认 → 认养人重确认配送批次 → 农场确认**，确认后证书换版、ETA 更新、退款出账、信用变化。
5. 用 **客服 `13900000006`** 打开异常工单，追加各角色处理事件并"登记赔付并结案"，
   观察工单状态自动变为"已赔付"、赔付折算回认养人权益；在冰雹工单内可**确认/驳回换品类**，
   保险报案推进（查勘/核定/到账）会自动把**理赔状态同步到工单流水给认养人**。
6. 用 **管理员 `13800000000`** 查看平台总览：品类销售、公益代捐份额、保险到账、结季成本与满意度、
   **冰雹减产分配跟踪与农场续认信用榜**。

已内置的完整故事线（批次 `APPLE-2026-A`）：

- 6 月冰雹 → 农场拍照报灾、保险报案与到账、平台**记录受灾照片/保险报案/可采果数量/补偿方案**并下发冰雹减产分配；
- **认养人三选一**：陈曦延期（加送精品果）/ 星辰科技换蓝莓礼盒（客服确认→认养人重新确认配送批次）/ 吴琳按比例退款；
  分配确认后**认养证书换发新版本、预计到货时间更新**，农场**续认信用**同步变化；
- 首批坏果率偏高 → 认养人投诉、物流出示温控记录、包装员整改、农场补发、客服回访闭环；
- 认养人出差 → 第二批发货前改地址，客服审核、物流更新冷链路线；
- 企业团购"净重/毛重"口径争议 → 包装员核对规格、农场发下季抵扣券、平台修订标注口径；
- 最终交付记录沉淀产量、发货、赔付、满意度、续认率与下一季建议。

---

## 四、本地开发（不用 Docker）

需要：Go 1.19+、Node.js 20+、PostgreSQL 15。

### 1. 准备数据库

```bash
createdb farmcrowd
# 数据库表结构与演示数据由后端启动时自动迁移（backend/internal/db/migrations/*.sql）
```

### 2. 启动后端（:8080）

```bash
cd backend
export DATABASE_URL="postgres://用户:密码@127.0.0.1:5432/farmcrowd?sslmode=disable"
go run ./cmd/server
```

后端在无 `STATIC_DIR` 时只提供 API，适合前后端分离开发。

### 3. 启动前端（:5173）

```bash
cd frontend
npm install
npm run dev        # 已在 vite.config.js 中把 /api 代理到 http://127.0.0.1:8080
```

打开 <http://localhost:5173>。生产模式下也可只跑后端并让 Go 托管前端构建产物：

```bash
cd frontend && npm run build
cd ../backend && STATIC_DIR=../frontend/dist go run ./cmd/server   # 然后访问 :8080
```

### 4. 测试

```bash
cd backend && go test ./...        # 单元测试
```

端到端 API 验证脚本 `backend/scripts/e2e_test.py`（仅依赖 Python3 标准库，无第三方包），
**需在全新初始化的数据库上运行**（脚本会新建认养、工单、结算等数据）：

```bash
# 1. 用空库启动后端（迁移+种子会自动执行）
# 2. 运行 108 项端到端断言（默认目标 http://127.0.0.1:8080，可用 FARMCROWD_BASE 覆盖）
python3 backend/scripts/e2e_test.py
# 容器场景：FARMCROWD_BASE=http://localhost:8080 python3 backend/scripts/e2e_test.py
```

覆盖：七角色登录鉴权、认养付款/超卖、保底权益量化核对（已发货+赔付折算）、
改地址拦截与建工单、灾害自动工单、成熟度抽检、采摘回填权限、分拣、发货状态机与
非法跳转拦截、全部送达订单自动完成、坏果工单 5 角色流水、赔付自动结案、
保险报案→到账、**理赔状态（查勘/核定/到账）同步认养人工单流水**、回访评分校验、
直播/参观/团购/公益、地块台账、看板、季末结算；以及 **43 项冰雹减产分配断言**：
种子方案三选一（延期/换品类/退款）、证书换版与 ETA 更新、可采果/承诺量/退款比例计算、
认养人选择与越权拦截、**换品类客服确认/驳回 + 认养人重新确认配送批次（顺序约束）**、
确认门禁（未客服确认/未批次重确认禁止最终确认）、按比例退款自动出账、
农场续认信用当季累计（104→107→105，A/B/C/D 分级）、限定适用订单（target_adoption_ids）、
项目详情/我的认养/农场看板/平台总览的聚合字段。

---

## 五、主要 API（JSON，除登录/浏览外均需 `Authorization: Bearer <token>`）

| 方法 & 路径 | 说明 |
|---|---|
| `POST /api/auth/login` `POST /api/auth/register` `GET /api/auth/me` | 登录/注册/当前用户 |
| `GET /api/projects` `GET /api/projects/{id}` `POST /api/projects` | 项目列表/聚合详情（农事+抽检+采摘+分拣+发货+工单+理赔+结算）/发布 |
| `POST /api/projects/{id}/logs` | 农事/施肥/用药/**灾害**日志（灾害自动建工单） |
| `POST /api/projects/{id}/checks` | 成熟度抽检（糖度、分级、坏果率、预估产量） |
| `POST /api/projects/{id}/harvests` `POST .../harvests/{hid}/complete` | 安排采摘 / 采摘工回填 |
| `POST /api/projects/{id}/sorting` | 分拣与包装规格 |
| `POST /api/projects/{id}/shipments` `POST .../shipments/{sid}/advance` | 分批发货编排 / 状态机 `planned→picked→packed→shipped→delivered` |
| `POST /api/projects/{id}/costs` `POST .../settle` | 地块记账 / 季末最终结算 |
| `POST /api/adoptions` `GET /api/my/adoptions` `POST /api/adoptions/{id}/address` | 付款（自动发证书，支持公益代捐）/ 我的权益核对 / 临时改地址 |
| `GET/POST /api/incidents` `GET/POST /api/incidents/{id}` `POST /api/incidents/{id}/events` | 异常工单与多角色处理流水 |
| `POST /api/compensations/incident/{id}` | 登记现金/补发/保险/下季抵扣赔付 |
| `GET/POST /api/insurance-claims` `POST /api/insurance-claims/{id}` | 保险报案/查勘/到账（到账自动生成赔付；状态推进同步冰雹工单流水给认养人） |
| `GET/POST /api/hail-allocations` `GET/POST /api/hail-allocations/{id}` `POST .../choose` `POST .../confirm` | **冰雹减产分配**：受灾照片/保险报案/可采果量/补偿方案、认养人三选一、最终确认（证书换版+ETA+退款出账+续认信用） |
| `POST /api/hail-choices/{id}/service` `POST /api/hail-choices/{id}/batch` | **客服确认换品类** / **换品类认养人重新确认配送批次** |
| `GET /api/farm/renew-credit` | 农场续认信用（当季分数与 A/B/C/D 等级） |
| `GET/POST /api/callbacks` | 成熟度回访（满意度+续认建议） |
| `GET /api/live` `POST /api/live/{id}` | 农场直播与开播流转 |
| `GET/POST /api/visits` `POST /api/visits/{id}` | 地块参观预约与审核 |
| `GET/POST /api/group-buys` `POST /api/group-buys/{id}` | 企业团购 |
| `GET /api/charity` | 公益认养榜 |
| `GET /api/plots/{id}/ledger` | **地块完整账**（投入→灾害→成熟→采摘→分拣→发货→售后→成本/满意度） |
| `GET /api/farm/dashboard` `GET /api/admin/overview` | 农场看板 / 平台总览 |

> 本项目为含前端业务页面的全栈应用，按任务约定不单独提供 Swagger/OpenAPI UI；
> 接口契约以上表与 `backend/internal/api` 源码为准。

---

## 六、数据模型要点

- 所有业务记录都携带 `project_id + batch_no`（认养批次号），这是把各方处理结果
  "串到同一认养批次"的主线；`incident_events` 以 `actor_role` 记录 6 类角色的每一步处置。
- `projects.guarantee_kg` 为每份保底产量；认养人权益 = 已发货量 + 赔付折算量（现金/抵扣按
  单价折回产量，补发按果品单价折算），在 `/api/my/adoptions` 的 `rights_fulfillment` 中量化呈现。
- `plot_costs` 六类成本（input/disaster/harvest/sorting/logistics/compensation）+
  `callbacks` 满意度/续认意愿 + `settlements` 最终交付，构成结季后的数据沉淀。
- **冰雹减产分配**三张表（迁移 `003`）：
  - `hail_allocations` 批次级方案：受灾照片 `photos`、关联保险报案 `insurance_claim_id` 与冰雹工单、
    可采果数量 `pickable_kg`、认养承诺总量 `committed_kg`、`delay_option`（延期 ETA+加送）、
    `switch_option`（可换品类 JSON 数组）、建议退款比例 `refund_pct`、补偿方案说明、
    `target_adoption_ids`（空=适用全部认养订单）、状态 `open→confirming→confirmed`；
  - `hail_choices` 每个认养订单一条：`option`（delay/switch/refund）、退款金额、换品类目标、
    新 ETA；换品类走两段确认——客服 `service_status`（pending→confirmed/rejected）后认养人
    `batch_status`（pending→confirmed，落一笔换品类后的计划发货批次 `batch_plan`）；
  - `farm_renew_credit` 农场当季续认信用：基础 100，每处置一次冰雹 +2，每份延期/换品类 +1、
    每份退款 −2，封顶 120/封底 0，映射 A(≥110)/B(≥90)/C(≥70)/D 等级。
  - 配套：`certificates` 增加 `version/reissue_note/updated_at`（确认后换发新版本），
    `adoptions.eta_date` 记录最新预计到货时间；确认时退款自动生成 `compensations(cash)` 现金赔付。

## 七、目录结构

```
.
├── docker-compose.yml          # db + app 一键启动
├── Dockerfile                  # 三阶段：node 构建前端 → go 构建后端 → alpine 运行
├── backend/
│   ├── cmd/server/main.go      # 入口（API + SPA 托管 + CORS + 自动迁移）
│   ├── internal/api/
│   │   ├── hail.go             # 冰雹减产分配（方案/三选一/客服确认/批次重确认/续认信用）
│   │   └── …                   # 其余路由与业务处理器
│   └── internal/db/
│       ├── db.go               # 连接池、迁移运行器
│       └── migrations/         # 001 建表 / 002 演示数据 / 003 冰雹减产分配（go:embed）
└── frontend/
    └── src/
        ├── App.jsx             # 路由与角色化导航
        ├── api.js auth.jsx
        └── pages/              # 项目/详情/我的认养/工单/农场工作台/地块账/服务/平台总览
```

## 八、实际执行过的验证（本环境）

- `go build ./...`、`go vet ./...`、`gofmt`：通过；`go test ./...`：通过（数值转换/折算单测）。
- 对真实 PostgreSQL 15 依次加载 `001/002/003` 迁移：原有 23 张表 + 新增 3 张
  （`hail_allocations/hail_choices/farm_renew_credit`）与 2 个加列（证书版本、订单 ETA）创建成功，
  种子数据可重复执行（幂等）；迁移后再次重启服务无重复执行、无错误。
- 启动 Go 服务后执行了 **108 项**端到端接口断言（真实 HTTP + 真实数据库），**全部通过**，
  覆盖：原有 65 项全链路断言（七角色鉴权、认养付款与证书、超卖拦截、保底权益核对、
  改地址拦截、灾害自动工单、抽检/采摘/分拣/发货状态机、坏果工单多角色流水、赔付结案、
  保险报案→到账、回访、直播/参观/团购/公益、地块台账、看板、季末结算），
  以及 **43 项冰雹减产分配断言**：种子三选一数据、证书换版与 ETA 更新、
  认养人三选一与越权拦截、换品类"客服确认→批次重确认"顺序门禁、未完成选择/确认时禁止最终确认、
  按比例退款自动出账、理赔状态同步工单流水、农场续认信用当季累计（104→107→105）、
  限定适用订单、各看板聚合字段。
- 前端 `npm install` + `npm run build`（Vite）：构建成功（46 模块，JS gzip ≈ 79KB，
  产物中已含"冰雹减产分配/重新确认配送批次/续认信用"等新功能代码）。
- 局限：本验证环境未安装 Docker 守护进程与无头浏览器，因此**未实际执行**
  `docker compose up` 的容器内联调与浏览器点击；Dockerfile 各构建步骤已分别用
  等价命令（npm ci/build、CGO 构建、alpine 健康检查命令）验证。
