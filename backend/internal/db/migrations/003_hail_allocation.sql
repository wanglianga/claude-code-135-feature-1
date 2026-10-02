-- 冰雹减产分配（hail production-loss allocation）
-- 一次冰雹减产事件 = 一条 hail_allocations：平台登记受灾照片、保险报案、可采果数量与补偿方案；
-- 每个受影响认养订单一条 hail_choices：认养人三选一（延期 / 换品类 / 按比例退款），
-- 换品类需客服确认、认养人再确认配送批次；确认后认养证书换发、预计到货时间更新，
-- 理赔状态同步认养人，全部确认后农场续认信用同步变化。

-- 农场续认信用（0~100，初始 100，每次减产分配关闭时按 credit_delta 同步）
ALTER TABLE farms ADD COLUMN IF NOT EXISTS renew_credit NUMERIC(5,2) NOT NULL DEFAULT 100;
ALTER TABLE farms ADD COLUMN IF NOT EXISTS renew_credit_note TEXT NOT NULL DEFAULT '';

-- 认养证书换发：版本号 + 换发原因（冰雹减产延期/换品类/按比例退款）
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS reissue_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS reissued_at TIMESTAMPTZ;

-- 发货运单增加预计到货日期与换购批次关联
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS eta_date DATE;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS hail_choice_id BIGINT;

-- 冰雹减产分配单（批次级，关联冰雹工单）
CREATE TABLE IF NOT EXISTS hail_allocations (
    id                BIGSERIAL PRIMARY KEY,
    incident_id       BIGINT NOT NULL UNIQUE REFERENCES incidents(id) ON DELETE CASCADE,
    project_id        BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    batch_no          TEXT NOT NULL,
    disaster_log_id   BIGINT REFERENCES farm_logs(id) ON DELETE SET NULL,  -- 受灾照片所在灾害日志
    insurance_claim_id BIGINT REFERENCES insurance_claims(id) ON DELETE SET NULL, -- 保险报案
    affected_shares   INT NOT NULL DEFAULT 0,        -- 受影响认养份额
    promised_kg       NUMERIC(10,2) NOT NULL DEFAULT 0, -- 认养承诺总产量（份额×保底）
    pickable_kg       NUMERIC(10,2) NOT NULL DEFAULT 0, -- 可采果数量
    shortage_kg       NUMERIC(10,2) NOT NULL DEFAULT 0, -- 保底缺口
    plan_delay        TEXT NOT NULL DEFAULT '',      -- 延期方案
    plan_swap         TEXT NOT NULL DEFAULT '',      -- 换品类方案
    plan_refund       TEXT NOT NULL DEFAULT '',      -- 按比例退款方案
    new_eta_date      DATE,                          -- 延期后新预计到货时间
    credit_delta      NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 对农场续认信用的影响（负=扣减）
    status            TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','published','closed')),
    created_by        BIGINT REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at      TIMESTAMPTZ,
    closed_at         TIMESTAMPTZ
);

-- 认养人的减产分配选择
CREATE TABLE IF NOT EXISTS hail_choices (
    id              BIGSERIAL PRIMARY KEY,
    allocation_id   BIGINT NOT NULL REFERENCES hail_allocations(id) ON DELETE CASCADE,
    adoption_id     BIGINT NOT NULL REFERENCES adoptions(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(id),
    option          TEXT NOT NULL CHECK (option IN ('delay','swap','refund')),
    -- 换品类
    swap_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
    swap_shares     INT NOT NULL DEFAULT 0,
    -- 换品类后的配送批次（认养人需重新确认）
    batch_seq       INT,
    batch_plan_date DATE,
    batch_spec      TEXT NOT NULL DEFAULT '',
    batch_eta_date  DATE,
    batch_status    TEXT NOT NULL DEFAULT 'pending' CHECK (batch_status IN ('pending','confirmed')),
    -- 客服确认换品类
    service_status  TEXT NOT NULL DEFAULT 'pending' CHECK (service_status IN ('pending','confirmed','rejected')),
    service_id      BIGINT REFERENCES users(id),
    service_note    TEXT NOT NULL DEFAULT '',
    serviced_at     TIMESTAMPTZ,
    -- 按比例退款
    refund_pct      NUMERIC(5,2) NOT NULL DEFAULT 0,
    refund_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- 延期后的预计到货
    eta_date        DATE,
    note            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at    TIMESTAMPTZ,
    UNIQUE (allocation_id, adoption_id)
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipments_hail_choice_fk') THEN
        ALTER TABLE shipments ADD CONSTRAINT shipments_hail_choice_fk
            FOREIGN KEY (hail_choice_id) REFERENCES hail_choices(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_hail_alloc_project ON hail_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_hail_choice_adoption ON hail_choices(adoption_id);
CREATE INDEX IF NOT EXISTS idx_hail_choice_user ON hail_choices(user_id);

-- =====================================================================
-- 演示数据：APPLE-2026-A 冰雹减产分配完整故事线
-- =====================================================================

-- 可换购品类：北洼晚秋蓝莓（冰雹换购批次）
INSERT INTO projects (id, farm_id, plot_id, batch_no, kind, title, description, unit_name,
    total_shares, sold_shares, price_per_share, guarantee_kg, est_mature_date, harvest_standard,
    delivery_range, rights_text, is_charity, insurance_policy, status) VALUES
 (6,1,2,'BERRY-2026-B','blueberry','北洼晚秋蓝莓认养 · 2026 秋（含冰雹换购批次）',
    '专为冰雹换购认养人准备的晚秋蓝莓一垄，品种“优瑞卡”秋果，每份额 = 1 垄，保底 6 斤鲜果，采后 2 小时预冷。',
    '垄',40,36,299.00,3.00,'2026-11-15',
    '果粉完整、单果≥16mm、糖度≥11%、采后2小时内预冷',
    '全国顺丰生鲜冷链','保底6斤晚秋蓝莓；48小时鲜达；坏果包赔；冰雹换购份额优先排产',FALSE,'','ongoing')
ON CONFLICT (id) DO NOTHING;
SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects));

-- 既有运单补预计到货日期；陈曦第二批按延期方案顺延至 10-28 发货、11-01 到货
UPDATE shipments SET eta_date='2026-10-19' WHERE id=1;
UPDATE shipments SET plan_date='2026-10-28', eta_date='2026-11-01',
    pack_spec='标准中果2箱+小果1箱（共16斤，剩余缺口保险折算补偿，延期至11月1日到货）'
WHERE id=2;
UPDATE shipments SET eta_date='2026-10-20' WHERE id=3;
UPDATE shipments SET eta_date='2026-06-26' WHERE id=4;
UPDATE shipments SET eta_date='2026-06-27' WHERE id=5;

-- 冰雹减产分配单：承诺 32 份×40斤=640kg，可采果 600kg，缺口 40kg（6.25%）
INSERT INTO hail_allocations (id, incident_id, project_id, batch_no, disaster_log_id, insurance_claim_id,
    affected_shares, promised_kg, pickable_kg, shortage_kg, plan_delay, plan_swap, plan_refund,
    new_eta_date, credit_delta, status, created_by, created_at, published_at, closed_at) VALUES
 (1,1,1,'APPLE-2026-A',4,1,32,640.00,600.00,40.00,
    '本季苹果认养继续有效：受冰雹影响的未发批次顺延至 10 月 28 日起冷链发货，预计 11 月 1 日前到货，保底缺口由保险理赔款按比例折算补偿。',
    '可换为北洼晚秋蓝莓（BERRY-2026-B），按已付金额等值兑换份额（¥599=2垄蓝莓），换品类经客服确认后重新编排配送批次并换发认养证书。',
    '按保底缺口比例 6.25% 原路退回（退款额=订单金额×6.25%），另赠下一季 95 折续认券 1 张。',
    '2026-11-01',-6.25,'closed',7,
    '2026-06-19 09:30:00+08','2026-06-19 10:00:00+08','2026-10-24 10:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('hail_allocations_id_seq', (SELECT MAX(id) FROM hail_allocations));

-- 三个认养人分别选择 延期 / 换品类 / 按比例退款
INSERT INTO hail_choices (id, allocation_id, adoption_id, user_id, option, swap_project_id, swap_shares,
    batch_seq, batch_plan_date, batch_spec, batch_eta_date, batch_status,
    service_status, service_id, service_note, serviced_at,
    refund_pct, refund_amount, eta_date, note, status, created_at, confirmed_at) VALUES
 (1,1,1,3,'delay',NULL,0,NULL,NULL,'',NULL,'pending',
    'pending',NULL,'',NULL,
    0,0,'2026-11-01','继续认养本季红富士，接受未发批次延期到 11 月 1 日前到货。','confirmed',
    '2026-06-20 09:00:00+08','2026-10-16 10:00:00+08'),
 (2,1,2,8,'swap',6,36,1,'2026-11-18','晚秋蓝莓企业礼盒 36 份（每份3斤，顺丰生鲜冷链整车直达上海）','2026-11-20','confirmed',
    'confirmed',7,'已按 ¥10782≈36 垄晚秋蓝莓等值兑换，结果同步客服与冷链调度，换购批次单独排产。','2026-10-17 09:30:00+08',
    0,0,NULL,'企业客户选择换品类：红富士苹果 → 北洼晚秋蓝莓 36 垄。','confirmed',
    '2026-06-20 14:00:00+08','2026-10-17 15:00:00+08'),
 (3,1,3,9,'refund',NULL,0,NULL,NULL,'',NULL,'pending',
    'pending',NULL,'',NULL,
    6.25,374.38,NULL,'按保底缺口 6.25% 原路退款，不再等待延期批次。','confirmed',
    '2026-06-21 11:00:00+08','2026-10-16 11:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('hail_choices_id_seq', (SELECT MAX(id) FROM hail_choices));

-- 换品类生成的换购配送批次（挂在 BERRY-2026-B 项目下）
INSERT INTO shipments (id, project_id, adoption_id, batch_no, seq, plan_date, eta_date, pack_spec, cold_route,
    weight_kg, status, logistics_company, tracking_no, bad_fruit_rate, operator_id, hail_choice_id) VALUES
 (6,6,2,'BERRY-2026-B',1,'2026-11-18','2026-11-20','晚秋蓝莓企业礼盒36份（每份3斤）','烟台-上海虹桥（蓝莓鲜果冷链整车）',
    108.00,'planned','顺丰冷运','',0.00,NULL,2)
ON CONFLICT (id) DO NOTHING;
SELECT setval('shipments_id_seq', (SELECT MAX(id) FROM shipments));

-- 按比例退款生成的赔付（现金退款，挂冰雹工单）
INSERT INTO compensations (id, incident_id, adoption_id, project_id, amount, kind, status, note, created_at, paid_at) VALUES
 (4,1,3,1,374.38,'cash','paid','冰雹减产按比例退款 6.25%（订单 ¥5990 × 6.25%），已原路退回，另附下季95折续认券。',
    '2026-10-16 11:05:00+08','2026-10-16 11:10:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('compensations_id_seq', (SELECT MAX(id) FROM compensations));

-- 证书换发 / 新签（adoption 1 的证书在 002 已存在，这里换发到第 2 版）
INSERT INTO certificates (id, adoption_id, cert_no, issued_at, version, reissue_reason, reissued_at) VALUES
 (1,1,'CERT-APPLE-2026-A-0001-R2','2026-06-01 09:12:00+08',2,
    '冰雹减产分配：认养人选择延期，未发批次预计 2026-11-01 到货，保底权益不变，证书换发至第 2 版。',
    '2026-10-16 10:00:00+08'),
 (3,2,'CERT-BERRY-2026-B-0002','2026-10-17 15:00:00+08',1,
    '冰雹减产分配：认养人选择换品类，红富士苹果 20 棵 → 北洼晚秋蓝莓 36 垄（批次 BERRY-2026-B），换品类后新签。',
    '2026-10-17 15:00:00+08'),
 (4,3,'CERT-APPLE-2026-A-0003-R2','2026-07-10 10:05:00+08',2,
    '冰雹减产分配：认养人选择按比例退款 6.25%（¥374.38 已退回），证书换发至第 2 版留存。',
    '2026-10-16 11:00:00+08')
ON CONFLICT (id) DO UPDATE SET
    cert_no=EXCLUDED.cert_no, version=EXCLUDED.version,
    reissue_reason=EXCLUDED.reissue_reason, reissued_at=EXCLUDED.reissued_at;
SELECT setval('certificates_id_seq', (SELECT MAX(id) FROM certificates));

-- 工单流水补充：三选一推送 / 三个选择 / 客服确认换品类 / 批次再确认 / 理赔状态同步
INSERT INTO incident_events (id, incident_id, actor_id, actor_role, action, note, created_at) VALUES
 (17,1,7,'service','推送冰雹减产三选一方案',
    '向 APPLE-2026-A 全部 32 个份额推送：①延期至11月1日到货 ②换购北洼晚秋蓝莓 ③按保底缺口6.25%原路退款。受灾照片、保险报案号 PICC-HAIL-2026-08831、可采果 600kg 一并公示。','2026-06-19 10:00:00+08'),
 (18,1,7,'service','保险理赔状态同步认养人','理赔状态更新为“已查勘”：人保现场确认冰雹属于保险责任，认养人可在订单中随时查看进度。','2026-06-22 10:00:00+08'),
 (19,1,7,'service','保险理赔状态同步认养人','理赔 ¥6000 已到账，状态更新为“已到账”，将按保底缺口折算到各认养人订单。','2026-07-02 15:30:00+08'),
 (20,1,3,'adopter','选择延期交付','陈曦确认选择方案①：继续认养红富士，未发批次延期至 11 月 1 日前到货。','2026-10-16 10:00:00+08'),
 (21,1,8,'adopter','选择换品类','星辰科技选择方案②：20 棵红富士等值换为 36 垄北洼晚秋蓝莓，等待客服确认。','2026-10-16 10:30:00+08'),
 (22,1,9,'adopter','选择按比例退款','吴琳选择方案③：按缺口 6.25% 原路退款 ¥374.38。','2026-10-16 11:00:00+08'),
 (23,1,7,'service','客服确认换品类并同步','确认 20 棵苹果→36 垄晚秋蓝莓等值兑换，换品类结果同步客服台账，通知农场与冷链预留 11-18 换购批次。','2026-10-17 09:30:00+08'),
 (24,1,8,'adopter','重新确认换品类配送批次','确认换购批次：第 1 批，11 月 18 日发货、11 月 20 日送达上海，36 份企业礼盒，认养证书已换发。','2026-10-17 15:00:00+08'),
 (25,1,7,'service','减产分配全部确认并同步信用','32 个份额全部完成三选一确认（延期1/换品类1/退款1，其余按方案①兜底），分配关闭；农场续认信用 100→93.75（-6.25）。','2026-10-24 10:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('incident_events_id_seq', (SELECT MAX(id) FROM incident_events));

-- 农场续认信用同步变化
UPDATE farms SET renew_credit=93.75,
    renew_credit_note='APPLE-2026-A 冰雹减产分配全部公平兑现，信用 100→93.75（缺口率 6.25%，-6.25）'
WHERE id=1;

-- 结季快照补上新增退款（赔付合计 39.90+260+560+374.38=1234.28）
UPDATE settlements SET total_compensation=1234.28,
    summary='苹果季受冰雹影响减产约8%，保险赔付6000元覆盖大部分损失；32 个认养份额通过“延期/换品类/按比例退款”三选一全部公平兑现（含企业客户换购晚秋蓝莓36垄）；认养箱坏果率控制在2%以内；企业客户对净重磅识提出改进，已完成口径修订。农场续认信用 100→93.75。下一季建议：增设防雹网、上线净重磅识模板、试点免套袋有机份额。'
WHERE project_id=1;
