-- 冰雹减产分配：平台记录受灾照片/保险报案/可采果数量/补偿方案，
-- 认养人三选一（延期 / 换品类 / 按比例退款），
-- 换品类需客服确认 + 认养人重新确认配送批次；
-- 分配确认后认养证书换新版本、预计到货时间更新、农场续认信用同步变化。

-- 认养证书支持换版（减产分配确认后换发）
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS version     INT NOT NULL DEFAULT 1;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ;
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS reissue_note TEXT NOT NULL DEFAULT '';

-- 订单预计到货时间（冰雹延期 / 换品类批次重确认后更新）
ALTER TABLE adoptions ADD COLUMN IF NOT EXISTS eta_date DATE;

-- 冰雹减产分配方案（批次级，挂在冰雹工单与保险报案上）
CREATE TABLE IF NOT EXISTS hail_allocations (
    id                BIGSERIAL PRIMARY KEY,
    project_id        BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    batch_no          TEXT NOT NULL,
    incident_id       BIGINT REFERENCES incidents(id) ON DELETE SET NULL,
    insurance_claim_id BIGINT REFERENCES insurance_claims(id) ON DELETE SET NULL,
    title             TEXT NOT NULL,
    photos            JSONB NOT NULL DEFAULT '[]',      -- 受灾照片
    pickable_kg       NUMERIC(10,2) NOT NULL DEFAULT 0, -- 可采果数量
    committed_kg      NUMERIC(10,2) NOT NULL DEFAULT 0, -- 认养承诺总量（份额×保底）
    delay_option      JSONB NOT NULL DEFAULT '{}',      -- 延期方案 {eta_date,note,bonus_kg}
    switch_option     JSONB NOT NULL DEFAULT '[]',      -- 可换品类 [{kind,title,kg_equiv,eta_date}]
    refund_pct        NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 建议按比例退款比例（缺口比例）
    compensation_plan TEXT NOT NULL DEFAULT '',         -- 补偿方案说明
    target_adoption_ids JSONB NOT NULL DEFAULT '[]',    -- 适用订单（空=本批次全部认养订单）
    status            TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open','confirming','confirmed','closed')),
    created_by        BIGINT REFERENCES users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmed_at      TIMESTAMPTZ
);

-- 认养人的减产选择（一份订单在同一方案下仅一条）
CREATE TABLE IF NOT EXISTS hail_choices (
    id             BIGSERIAL PRIMARY KEY,
    allocation_id  BIGINT NOT NULL REFERENCES hail_allocations(id) ON DELETE CASCADE,
    adoption_id    BIGINT NOT NULL REFERENCES adoptions(id) ON DELETE CASCADE,
    user_id        BIGINT NOT NULL REFERENCES users(id),
    option         TEXT NOT NULL CHECK (option IN ('delay','switch','refund')),
    refund_pct     NUMERIC(5,2) NOT NULL DEFAULT 0,
    refund_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
    switch_project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
    switch_kind    TEXT NOT NULL DEFAULT '',
    switch_title   TEXT NOT NULL DEFAULT '',
    switch_kg      NUMERIC(10,2),
    eta_date       DATE,                               -- 新预计到货时间
    note           TEXT NOT NULL DEFAULT '',
    -- 换品类：客服确认
    service_status TEXT NOT NULL DEFAULT 'n/a'
        CHECK (service_status IN ('n/a','pending','confirmed','rejected')),
    service_by     BIGINT REFERENCES users(id),
    service_at     TIMESTAMPTZ,
    service_note   TEXT NOT NULL DEFAULT '',
    -- 换品类：认养人重新确认配送批次
    batch_status   TEXT NOT NULL DEFAULT 'n/a'
        CHECK (batch_status IN ('n/a','pending','confirmed')),
    batch_plan     JSONB NOT NULL DEFAULT '{}',
    batch_by       BIGINT REFERENCES users(id),
    batch_at       TIMESTAMPTZ,
    status         TEXT NOT NULL DEFAULT 'chosen'
        CHECK (status IN ('chosen','confirmed','done','canceled')),
    confirmed_at   TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (allocation_id, adoption_id)
);

-- 农场续认信用（冰雹减产处置后同步变化）
CREATE TABLE IF NOT EXISTS farm_renew_credit (
    id              BIGSERIAL PRIMARY KEY,
    farm_id         BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    project_id      BIGINT REFERENCES projects(id) ON DELETE SET NULL,
    season          TEXT NOT NULL DEFAULT '2026',
    score           NUMERIC(5,2) NOT NULL DEFAULT 100,
    level           TEXT NOT NULL DEFAULT 'B',
    hail_handled    INT NOT NULL DEFAULT 0,
    delayed_shares  INT NOT NULL DEFAULT 0,
    switched_shares INT NOT NULL DEFAULT 0,
    refunded_shares INT NOT NULL DEFAULT 0,
    delta           NUMERIC(5,2) NOT NULL DEFAULT 0,
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (farm_id, season)
);

CREATE INDEX IF NOT EXISTS idx_hail_alloc_project ON hail_allocations(project_id);
CREATE INDEX IF NOT EXISTS idx_hail_choices_adoption ON hail_choices(adoption_id);
CREATE INDEX IF NOT EXISTS idx_hail_choices_alloc ON hail_choices(allocation_id);

-- =====================================================================
-- 演示数据：APPLE-2026-A 冰雹减产分配完整故事线（幂等）
-- =====================================================================

-- 证书：陈曦订单换版（延期）；周凯、吴琳订单补录证书并换版（换品类/退款）
INSERT INTO certificates (id, adoption_id, cert_no, version, reissue_note, updated_at) VALUES
 (1,1,'CERT-APPLE-2026-A-0001',2,'冰雹减产分配：选择延期交付，第二批预计到货更新为 2026-11-05，加送精品果2斤。','2026-10-25 10:00:00+08'),
 (3,2,'CERT-APPLE-2026-A-0002',2,'冰雹减产分配：企业团购换为优瑞卡蓝莓鲜果礼盒，配送批次已于 2026-11-10 重新确认。','2026-10-25 10:00:00+08'),
 (4,3,'CERT-APPLE-2026-A-0003',2,'冰雹减产分配：按缺口比例退款 12%（¥718.80），保底权益差额已结清。','2026-10-25 10:00:00+08')
ON CONFLICT (adoption_id) DO UPDATE SET
  version=EXCLUDED.version, reissue_note=EXCLUDED.reissue_note, updated_at=EXCLUDED.updated_at;
SELECT setval('certificates_id_seq', GREATEST((SELECT MAX(id) FROM certificates), 4));

-- 订单预计到货时间
UPDATE adoptions SET eta_date='2026-11-05' WHERE id=1;
UPDATE adoptions SET eta_date='2026-11-10' WHERE id=2;

-- 周凯换品类后的替换配送批次（仍挂在原批次，规格注明换品类）
INSERT INTO shipments (id, project_id, adoption_id, batch_no, seq, plan_date, pack_spec, cold_route, weight_kg, status, created_at) VALUES
 (6,1,2,'APPLE-2026-A',2,'2026-11-10','【换品类】优瑞卡蓝莓鲜果礼盒2盒（约3斤）+ 洋槐蜜1瓶补差','烟台-上海虹桥（生鲜冷链整车 鲁F·D7721）',1.50,'planned','2026-10-25 10:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('shipments_id_seq', GREATEST((SELECT MAX(id) FROM shipments), 6));

-- 吴琳按比例退款赔付（10 份 × 599 × 12% = 718.80）
INSERT INTO compensations (id, incident_id, adoption_id, project_id, amount, kind, status, note, created_at, paid_at) VALUES
 (4,1,3,1,718.80,'cash','paid','冰雹减产按比例退款 12%（保底缺口约7.5%，含保险补贴综合折算），原路退回','2026-10-25 10:00:00+08','2026-10-25 10:30:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('compensations_id_seq', GREATEST((SELECT MAX(id) FROM compensations), 4));

-- 减产分配方案：承诺 32 份×20kg=640kg，实测可采 592kg（缺口约 7.5%）
INSERT INTO hail_allocations (id, project_id, batch_no, incident_id, insurance_claim_id, title, photos,
    pickable_kg, committed_kg, delay_option, switch_option, refund_pct, compensation_plan, target_adoption_ids, status, created_by, created_at, confirmed_at) VALUES
 (1,1,'APPLE-2026-A',1,1,'东坡3号苹果园冰雹减产分配方案（APPLE-2026-A）',
  '[{"caption":"雹后落果","url":"/static/demo/hail1.jpg"},{"caption":"雹伤果实拍","url":"/static/demo/hail2.jpg"},{"caption":"可采果实测称重","url":"/static/demo/hail-pickable.jpg"}]',
  592.00,640.00,
  '{"eta_date":"2026-11-05","note":"第二批延期至 11 月 5 日发出，加送精品大果 2 斤，冷链不变","bonus_kg":1.00}',
  '[{"kind":"blueberry","title":"优瑞卡蓝莓鲜果礼盒2盒（约3斤）","kg_equiv":1.50,"eta_date":"2026-11-10"},{"kind":"honey","title":"西坡洋槐蜜2斤装","kg_equiv":1.00,"eta_date":"2026-10-30"}]',
  12.00,
  '保险理赔 ¥6000 已到账；按实测缺口 7.5% 折算，认养人可三选一：①延期至11月5日并加送2斤；②换蓝莓/洋槐蜜等量配送；③按订单金额 12% 原路退款。未足额部分由农场承担。',
  '[1,2,3]',
  'confirmed',2,'2026-10-15 14:00:00+08','2026-10-25 10:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('hail_allocations_id_seq', GREATEST((SELECT MAX(id) FROM hail_allocations), 1));

-- 三个认养人的选择：陈曦延期 / 周凯换品类（客服确认+批次重确认）/ 吴琳退款
INSERT INTO hail_choices (id, allocation_id, adoption_id, user_id, option, refund_pct, refund_amount,
    switch_kind, switch_title, switch_kg, eta_date, note,
    service_status, service_by, service_at, service_note,
    batch_status, batch_plan, batch_by, batch_at, status, confirmed_at) VALUES
 (1,1,1,3,'delay',0,0,'','',NULL,'2026-11-05','选择延期，信任农场防雹与加送方案',
  'n/a',NULL,NULL,'',
  'n/a','{}',NULL,NULL,'confirmed','2026-10-25 10:00:00+08'),
 (2,1,2,8,'switch',0,0,'blueberry','优瑞卡蓝莓鲜果礼盒2盒（约3斤）',1.50,'2026-11-10','企业福利希望按时发放，选择换蓝莓礼盒',
  'confirmed',7,'2026-10-23 15:00:00+08','客服核对蓝莓库存与企业收货时间，确认换品类并同步客服工单组',
  'confirmed','{"seq":2,"plan_date":"2026-11-10","pack_spec":"【换品类】优瑞卡蓝莓鲜果礼盒2盒+洋槐蜜1瓶补差","cold_route":"烟台-上海虹桥（生鲜冷链整车）","weight_kg":1.50}',
  8,'2026-10-24 11:20:00+08','confirmed','2026-10-25 10:00:00+08'),
 (3,1,3,9,'refund',12.00,718.80,'','',NULL,NULL,'家中果树收成尚可，选择按比例退款',
  'n/a',NULL,NULL,'',
  'n/a','{}',NULL,NULL,'confirmed','2026-10-25 10:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('hail_choices_id_seq', GREATEST((SELECT MAX(id) FROM hail_choices), 3));

-- 冰雹工单追加减产分配流水（理赔状态同步认养人）
INSERT INTO incident_events (id, incident_id, actor_id, actor_role, action, note, created_at) VALUES
 (17,1,7,'service','推送冰雹减产三选一方案','理赔状态：已到账 ¥6000.00，同步全部认养人；可选择延期（加送2斤）/换蓝莓或洋槐蜜/按12%退款。','2026-10-15 14:05:00+08'),
 (18,1,3,'adopter','认养人选择延期交付','陈曦选择第二批延期至 2026-11-05，接受加送精品果2斤。','2026-10-16 09:00:00+08'),
 (19,1,8,'adopter','认养人选择换品类','星辰科技选择换优瑞卡蓝莓鲜果礼盒2盒（约3斤），要求 11 月上旬送达。','2026-10-16 10:30:00+08'),
 (20,1,7,'service','客服确认换品类结果','核对蓝莓库存与企业收货档期，确认换品类；换品类结果已同步客服工单组与冷链调度。','2026-10-23 15:00:00+08'),
 (21,1,8,'adopter','重新确认换品类配送批次','确认第2批 2026-11-10 烟台-上海虹桥生鲜冷链整车，礼盒2盒+洋槐蜜1瓶补差。','2026-10-24 11:20:00+08'),
 (22,1,9,'adopter','认养人选择按比例退款','吴琳选择按缺口比例退款 12%，¥718.80 原路退回。','2026-10-17 16:00:00+08'),
 (23,1,2,'farmer','减产分配确认','全部份额分配确认完毕：认养证书已换发新版本，预计到货时间已更新，退款已出账。','2026-10-25 10:00:00+08'),
 (24,1,7,'service','农场续认信用同步','本季冰雹处置：延期2份、换品类20份、退款10份；续认信用 +4 分，当前 104 分（B 级守信农场）。','2026-10-25 10:05:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('incident_events_id_seq', GREATEST((SELECT MAX(id) FROM incident_events), 24));

-- 农场续认信用：100 + 冰雹处置2 + 延期2×1 + 换品类20×1 - 退款10×2 = 104（B 级）
INSERT INTO farm_renew_credit (id, farm_id, project_id, season, score, level, hail_handled,
    delayed_shares, switched_shares, refunded_shares, delta, note, updated_at) VALUES
 (1,1,1,'2026',104.00,'B',1,2,20,10,4.00,
  '冰雹减产分配履约到位：换品类与延期份额保信用，退款份额小幅扣分；理赔信息全程同步认养人。','2026-10-25 10:05:00+08')
ON CONFLICT (farm_id, season) DO UPDATE SET
  score=EXCLUDED.score, level=EXCLUDED.level, hail_handled=EXCLUDED.hail_handled,
  delayed_shares=EXCLUDED.delayed_shares, switched_shares=EXCLUDED.switched_shares,
  refunded_shares=EXCLUDED.refunded_shares, delta=EXCLUDED.delta, note=EXCLUDED.note,
  updated_at=EXCLUDED.updated_at;
SELECT setval('farm_renew_credit_id_seq', GREATEST((SELECT MAX(id) FROM farm_renew_credit), 1));
