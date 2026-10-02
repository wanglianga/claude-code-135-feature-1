-- 演示数据：密码均为 farm123（Go 端以 sha256 校验）
INSERT INTO users (id, name, phone, password_hash, role) VALUES
 (1,'平台管理员','13800000000','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','admin'),
 (2,'李远山（谷香农场主）','13900000001','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','farmer'),
 (3,'陈曦（认养人）','13900000002','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','adopter'),
 (4,'赵秀兰（采摘工）','13900000003','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','picker'),
 (5,'王梅（包装员）','13900000004','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','packer'),
 (6,'马建国（冷链司机）','13900000005','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','logistics'),
 (7,'孙悦（客服）','13900000006','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','service'),
 (8,'周凯（星辰科技行政）','13900000007','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','adopter'),
 (9,'吴琳（认养人）','13900000008','e15f69372a1000a08c8279e6ec361d1e48979d4daacc098c714cc64030470add','adopter')
ON CONFLICT (id) DO NOTHING;
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

INSERT INTO farms (id, name, owner_id, location, intro) VALUES
 (1,'谷香家庭农场',2,'山东烟台栖霞市唐家泊镇','海拔 380 米丘陵果园，占地 120 亩，主营红富士苹果、蓝莓、洋槐蜜、水稻与有机蔬菜，连续 6 年绿色食品认证。')
ON CONFLICT (id) DO NOTHING;
SELECT setval('farms_id_seq', (SELECT MAX(id) FROM farms));
UPDATE users SET farm_id=1 WHERE id IN (2,4,5);

INSERT INTO plots (id, farm_id, name, area_mu, crop, location) VALUES
 (1,1,'东坡3号苹果园',18.00,'apple','农场东坡，向阳缓坡'),
 (2,1,'北洼蓝莓园',6.00,'blueberry','北洼谷地，微酸土壤'),
 (3,1,'西坡洋槐蜜源林',30.00,'honey','西坡林地，48 个蜂箱'),
 (4,1,'南塘水稻田',25.00,'rice','南塘河畔，山泉水灌溉'),
 (5,1,'暖棚有机菜地',8.00,'vegetable','农场南侧连栋暖棚')
ON CONFLICT (id) DO NOTHING;
SELECT setval('plots_id_seq', (SELECT MAX(id) FROM plots));

INSERT INTO projects (id, farm_id, plot_id, batch_no, kind, title, description, unit_name,
    total_shares, sold_shares, price_per_share, guarantee_kg, est_mature_date, harvest_standard, delivery_range, rights_text, is_charity, insurance_policy, status) VALUES
 (1,1,1,'APPLE-2026-A','apple','认养一棵红富士苹果树 · 2026 季',
    '东坡3号园，树龄 12 年红富士。每份额 = 1 棵树，保底 40 斤，分批冷链到家。',
    '棵',100,32,599.00,20.00,'2026-10-20',
    '糖度≥14%、果径80mm 以上、着色面≥80%、无碰压伤',
    '全国顺丰冷链（新疆/西藏/海南不发，可改发亲友）',
    '保底40斤精品果；农事日志+直播全透明；冰雹减产按比例赔付或下一季抵扣；含认养证书1份、地块参观1次',
    FALSE,'PICC-HAIL-2026-08831','harvesting'),
 (2,1,2,'BERRY-2026-A','blueberry','蓝莓园一垄认养 · 2026 季',
    '北洼蓝莓园，品种“优瑞卡”，每份额 = 1 垄（约 8 株），保底 6 斤鲜果。',
    '垄',60,18,299.00,3.00,'2026-06-25',
    '果粉完整、单果≥16mm、糖度≥11%、采后 2 小时内预冷',
    '全国顺丰生鲜冷链','保底6斤；48小时鲜达；坏果包赔',FALSE,'','completed'),
 (3,1,3,'HONEY-2026-A','honey','认养蜂箱 · 洋槐蜜 2026 季',
    '西坡洋槐蜜源林，每份额 = 1 箱蜜蜂，年产成熟封盖蜜保底 8 斤。',
    '箱',48,21,399.00,4.00,'2026-05-20',
    '41.5 波美度以上、自然成熟封盖蜜、蔗糖≤5%',
    '全国快递包邮','保底8斤封盖蜜；可参加摇蜜体验1次',FALSE,'','completed'),
 (4,1,4,'RICE-2026-A','rice','南塘水稻田一分田认养 · 2026 季',
    '山泉水灌溉稻花香2号，每份额 = 1 分田，保底 60 斤大米。',
    '分',250,156,269.00,30.00,'2026-10-10',
    '出米率≥65%、水分≤14.5%、无抛光无打蜡',
    '全国普通快递包邮','保底60斤新米；支持公益代捐；秋收可带家人割稻',TRUE,'','ongoing'),
 (5,1,5,'VEG-2026-A','vegetable','有机蔬菜家庭份额 · 2026 秋冬季',
    '暖棚当季叶菜根茎 12 个品种，每周一箱 8 斤，共配送 12 周。',
    '周份',120,64,39.00,4.00,'2026-10-15',
    '有机标准种植、零化学农药、采后 12 小时内发出',
    '烟台同城及胶东半岛冷链','每周一箱8斤当季菜；缺品种同价位替换并提前告知',FALSE,'','ongoing')
ON CONFLICT (id) DO NOTHING;
SELECT setval('projects_id_seq', (SELECT MAX(id) FROM projects));

-- 农事日志
INSERT INTO farm_logs (id, project_id, batch_no, author_id, log_type, title, content, photos, disaster_kind, yield_impact_pct) VALUES
 (1,1,'APPLE-2026-A',2,'farming','春季修剪','按开心形修剪，疏除交叉枝、病虫枝，保证树体通风透光。','[{"caption":"修剪后的树形","url":"/static/demo/apple-prune.jpg"}]','',0),
 (2,1,'APPLE-2026-A',2,'fertilizer','春季基肥','每株施腐熟羊粪 30 斤 + 豆粕 5 斤，沿树冠投影开沟施入。','[]','',0),
 (3,1,'APPLE-2026-A',2,'pesticide','花后用药','喷施生物农药苦参碱防治蚜虫，未使用化学杀虫剂，安全间隔期 14 天。','[]','',0),
 (4,1,'APPLE-2026-A',2,'disaster','遭遇冰雹灾害','6月18日午后突降冰雹约 15 分钟，东坡为主要受灾区，套袋果约 25% 出现轻微雹伤，已拍照报保险。','[{"caption":"雹后落果","url":"/static/demo/hail1.jpg"},{"caption":"雹伤果实拍","url":"/static/demo/hail2.jpg"}]','冰雹',25.00),
 (5,1,'APPLE-2026-A',2,'photo','摘袋转色','9月28日完成外袋摘除，铺设反光膜，预计 10 月 18 日达到采摘糖度。','[{"caption":"摘袋上色中","url":"/static/demo/apple-color.jpg"}]','',0),
 (6,2,'BERRY-2026-A',2,'farming','蓝莓采收结束','6 月 26 日完成最后一垄采收，全园预冷分级后当日发出。','[]','',0),
 (7,3,'HONEY-2026-A',2,'farming','洋槐蜜摇蜜','5月18日摇取头茬封盖蜜，波美度 41.8。','[]','',0),
 (8,4,'RICE-2026-A',2,'farming','水稻灌浆期','9月15日巡查，稻穗灌浆整齐，山泉水灌溉未断水，预计 10 月 8 日开镰。','[{"caption":"金黄稻田","url":"/static/demo/rice.jpg"}]','',0),
 (9,5,'VEG-2026-A',2,'photo','暖棚秋菜定植','奶油白菜、水果萝卜、乌塌菜已定植，黄板诱虫，无化学农药。','[]','',0)
ON CONFLICT (id) DO NOTHING;
SELECT setval('farm_logs_id_seq', (SELECT MAX(id) FROM farm_logs));

-- 认养订单
INSERT INTO adoptions (id, project_id, batch_no, user_id, shares, unit_price, amount, is_corporate, company_name, recipient_name, phone, address, status, created_at) VALUES
 (1,1,'APPLE-2026-A',3,2,599.00,1198.00,FALSE,'','陈曦','13900000002','北京市朝阳区建国路88号SOHO现代城A座1203','shipping','2026-06-01 09:12:00+08'),
 (2,1,'APPLE-2026-A',8,20,539.10,10782.00,TRUE,'星辰科技有限公司','周凯','13900000007','上海市浦东新区张江高科技园区博云路2号A栋前台','shipping','2026-06-03 14:30:00+08'),
 (3,1,'APPLE-2026-A',9,10,599.00,5990.00,FALSE,'','吴琳','13900000008','杭州市西湖区文三路478号华星时代广场','paid','2026-07-10 10:05:00+08'),
 (4,2,'BERRY-2026-A',3,1,299.00,299.00,FALSE,'','陈曦','13900000002','北京市朝阳区建国路88号SOHO现代城A座1203','completed','2026-05-20 11:00:00+08'),
 (5,2,'BERRY-2026-A',8,10,284.05,2840.50,TRUE,'星辰科技有限公司','周凯','13900000007','上海市浦东新区张江高科技园区博云路2号A栋前台','completed','2026-05-21 16:20:00+08'),
 (6,4,'RICE-2026-A',3,1,269.00,269.00,FALSE,'','陈曦','13900000002','北京市朝阳区建国路88号SOHO现代城A座1203','paid','2026-06-15 09:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('adoptions_id_seq', (SELECT MAX(id) FROM adoptions));

-- 成熟度抽检
INSERT INTO maturity_checks (id, project_id, batch_no, inspector_id, brix, sample_count, maturity_pct, est_yield_kg, grade_dist, bad_rate_pct, notes, checked_at) VALUES
 (1,1,'APPLE-2026-A',2,12.6,30,65.00,2600.00,'{"large":55,"mid":35,"small":10}',3.20,'摘袋前抽检，淀粉染色 4 级，预计 10 月 20 日成熟','2026-10-01 09:30:00+08'),
 (2,1,'APPLE-2026-A',2,14.3,40,92.00,2400.00,'{"large":52,"mid":36,"small":12}',4.80,'冰雹后复测：总产量预估下调约 8%，雹伤果转加工渠道，不进入认养箱','2026-10-15 09:30:00+08'),
 (3,2,'BERRY-2026-A',2,11.8,50,98.00,420.00,'{"large":60,"mid":32,"small":8}',2.10,'果粉厚、硬度好，达到采收标准','2026-06-24 08:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('maturity_checks_id_seq', (SELECT MAX(id) FROM maturity_checks));

-- 采摘任务
INSERT INTO harvest_tasks (id, project_id, batch_no, plot_id, picker_id, priority, planned_date, target_kg, actual_kg, bad_rate_pct, status) VALUES
 (1,1,'APPLE-2026-A',1,4,10,'2026-10-18',600.00,586.00,4.50,'done'),
 (2,1,'APPLE-2026-A',1,4,50,'2026-10-21',1200.00,NULL,NULL,'planned')
ON CONFLICT (id) DO NOTHING;
SELECT setval('harvest_tasks_id_seq', (SELECT MAX(id) FROM harvest_tasks));

-- 分拣
INSERT INTO sorting_records (id, project_id, batch_no, packer_id, spec, weight_kg, box_count) VALUES
 (1,1,'APPLE-2026-A',5,'精品大果（80-85mm/12枚装）',218.00,90),
 (2,1,'APPLE-2026-A',5,'标准中果（75-80mm/15枚装）',264.00,110),
 (3,1,'APPLE-2026-A',5,'实惠小果（70-75mm/20枚装）',80.00,32),
 (4,1,'APPLE-2026-A',5,'雹伤加工果（不入认养箱）',24.00,0)
ON CONFLICT (id) DO NOTHING;
SELECT setval('sorting_records_id_seq', (SELECT MAX(id) FROM sorting_records));

-- 分批发货
INSERT INTO shipments (id, project_id, adoption_id, batch_no, seq, plan_date, pack_spec, cold_route, weight_kg, status,
    logistics_company, tracking_no, bad_fruit_rate, operator_id, shipped_at, delivered_at) VALUES
 (1,1,1,'APPLE-2026-A',1,'2026-10-18','精品大果2箱+标准中果1箱（共24斤）','烟台-济南分拨-北京朝阳（全程0-4℃冷链车 鲁F·D7721）',12.00,'delivered',
    '顺丰冷运','SFCOLD102600188',5.20,6,'2026-10-18 18:00:00+08','2026-10-19 14:20:00+08'),
 (2,1,1,'APPLE-2026-A',2,'2026-11-05','标准中果2箱+小果1箱（共16斤，冰雹减产后延期批次，加送精品大果2斤）','烟台-杭州分拨-北京（冷链车 鲁F·D7721）',8.00,'planned',
    '顺丰冷运','',0.00,NULL,NULL,NULL),
 (3,1,2,'APPLE-2026-A',1,'2026-10-18','企业团购礼盒40箱（精品大果，每箱5.4斤）','烟台-上海虹桥（整车冷链直达）',216.00,'shipped',
    '顺丰冷运','SFCOLD102600205',1.80,6,'2026-10-18 20:30:00+08',NULL),
 (4,2,4,'BERRY-2026-A',1,'2026-06-25','优瑞卡鲜果6斤礼盒装','烟台-北京（生鲜专机+冷链）',3.00,'delivered',
    '顺丰冷运','SFFRESH2026062501',0.00,6,'2026-06-25 09:00:00+08','2026-06-26 10:00:00+08'),
 (5,2,5,'BERRY-2026-A',1,'2026-06-26','企业团购蓝莓礼盒10箱（30斤）','烟台-上海虹桥（生鲜冷链整车）',15.00,'delivered',
    '顺丰冷运','SFFRESH2026062608',0.80,6,'2026-06-26 07:30:00+08','2026-06-27 09:30:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('shipments_id_seq', (SELECT MAX(id) FROM shipments));

-- 异常工单（三类典型争议，串在同一批次）
INSERT INTO incidents (id, project_id, batch_no, adoption_id, kind, title, description, status, reporter_id, created_at, resolved_at) VALUES
 (1,1,'APPLE-2026-A',NULL,'hail','冰雹导致东坡园预计减产约25%','6月18日冰雹造成套袋果雹伤，认养份额保底产量存在缺口，需统一处置方案。','resolved',2,'2026-06-18 16:00:00+08','2026-06-25 17:00:00+08'),
 (2,1,'APPLE-2026-A',1,'bad_fruit','首批到货坏果率偏高投诉','陈曦反馈第一批苹果 36 枚中有 2 枚碰压伤、1 枚腐烂，坏果率约 8%，超过承诺标准。','compensated',3,'2026-10-20 09:15:00+08','2026-10-22 15:00:00+08'),
 (3,1,'APPLE-2026-A',1,'address_change','第二批发货前临时变更收货地址','认养人因出差，要求第二批改寄杭州父母家，需在采摘排产前更新冷链路线。','resolved',3,'2026-10-19 20:40:00+08','2026-10-20 10:00:00+08'),
 (4,1,'APPLE-2026-A',2,'rights_mismatch','企业团购反映实际到货与权益口径不一致','星辰科技反馈礼盒实际为 5.4 斤/箱，采购时沟通口径为“每箱约6斤”，要求解释并补偿。','compensated',8,'2026-10-20 16:00:00+08','2026-10-23 11:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('incidents_id_seq', (SELECT MAX(id) FROM incidents));

-- 工单处理流水（农场/认养人/采摘工/包装员/物流/客服在同一批次闭环）
INSERT INTO incident_events (id, incident_id, actor_id, actor_role, action, note, created_at) VALUES
 -- 冰雹单
 (1,1,2,'farmer','报案并上传现场照片','雹后 1 小时内全园巡查拍照，雹伤果约 25%，已向人保提交理赔材料。','2026-06-18 16:30:00+08'),
 (2,1,7,'service','启动批量安抚预案','向 APPLE-2026-A 全部 32 个认养份额推送情况说明，提供“现金赔付/补发/下季抵扣”三选一。','2026-06-19 09:00:00+08'),
 (3,1,4,'picker','复核实测减产','采摘前对 10 棵抽样树实测称重，确认实际减产 8%（套袋保护有效），雹伤果全部转加工渠道。','2026-10-15 11:00:00+08'),
 (4,1,7,'service','公布处置结果','保险理赔到账后，按实际缺口折算赔付，未足额部分由农场承担，保证保底权益。','2026-10-24 10:00:00+08'),
 -- 坏果单
 (5,2,3,'adopter','提交投诉与照片','上传 3 枚问题果照片与开箱视频，要求按坏果包赔处理。','2026-10-20 09:15:00+08'),
 (6,2,6,'logistics','提供冷链温控记录','全程温控曲线 0.8-3.6℃ 达标，中转时长正常，判定为包装缓冲不足导致碰压。','2026-10-20 14:00:00+08'),
 (7,2,5,'packer','包装复查与整改','复查同批次网套与隔板，加厚珍珠棉隔板，后续批次坏果率降至 1.8%。','2026-10-21 10:30:00+08'),
 (8,2,2,'farmer','同意补发并致歉','第二批优先补发精品大果 6 枚并附手写致歉卡。','2026-10-21 15:00:00+08'),
 (9,2,7,'service','回访确认','电话回访确认补发已签收，认养人表示满意。','2026-10-22 15:00:00+08'),
 -- 改地址单
 (10,3,3,'adopter','申请改地址','新地址：杭州市西湖区文三路478号，10月22日前可改。','2026-10-19 20:40:00+08'),
 (11,3,7,'service','审核并同步','核对订单未进入拣货环节，同意变更并同步农场与冷链调度。','2026-10-20 09:00:00+08'),
 (12,3,6,'logistics','更新冷链路线','第二批路线调整为烟台-杭州分拨，增加冰袋 2 个，运费不变。','2026-10-20 10:00:00+08'),
 -- 权益口径单
 (13,4,8,'adopter','提出异议','合同未明确单箱净重，礼盒实物 5.4 斤与“约6斤”有偏差，40 箱合计差约 24 斤。','2026-10-20 16:00:00+08'),
 (14,4,5,'packer','核对包装规格','精品大果 12 枚装平均单果 225g，净重 5.4 斤为标准规格，页面标注为毛重口径不清。','2026-10-21 09:30:00+08'),
 (15,4,2,'farmer','给出补偿方案','差额按团购价折算 ¥260，以下一季认养抵扣券形式发放，并修订页面为净重现标。','2026-10-22 14:00:00+08'),
 (16,4,7,'service','闭环归档','客户确认接受抵扣券，工单关闭；同步运营修改全部项目重量标注口径。','2026-10-23 11:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('incident_events_id_seq', (SELECT MAX(id) FROM incident_events));

-- 赔付
INSERT INTO compensations (id, incident_id, adoption_id, project_id, amount, kind, status, note, created_at, paid_at) VALUES
 (1,2,1,1,39.90,'reship','paid','补发精品大果6枚（约2.7斤），折值39.90元','2026-10-21 15:30:00+08','2026-10-22 12:00:00+08'),
 (2,4,2,1,260.00,'credit','paid','下一季认养抵扣券260元，已发至企业账户','2026-10-22 14:30:00+08','2026-10-23 11:00:00+08'),
 (3,1,1,1,560.00,'insurance','paid','冰雹保险理赔款到账，按保底产量缺口折算现金发放（含10月23日第二批次8kg在途权益）','2026-07-03 10:00:00+08','2026-07-03 16:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('compensations_id_seq', (SELECT MAX(id) FROM compensations));

-- 保险理赔
INSERT INTO insurance_claims (id, project_id, batch_no, policy_no, kind, loss_kg, amount, status, note, applied_at, settled_at) VALUES
 (1,1,'APPLE-2026-A','PICC-HAIL-2026-08831','冰雹',200.00,6000.00,'settled','现场查勘确认冰雹灾害属于保险责任，按亩产损失赔付。','2026-06-19 09:30:00+08','2026-07-02 15:00:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('insurance_claims_id_seq', (SELECT MAX(id) FROM insurance_claims));

-- 回访
INSERT INTO callbacks (id, project_id, adoption_id, satisfaction, quality_score, delivery_score, would_renew, comment, renew_suggestion) VALUES
 (1,1,1,5,5,4,TRUE,'苹果很甜，孩子爱吃；第一批碰了几个，补发很快。透明的农事日志让人放心，明年还认养。','建议下一季增加“免套袋有机果”份额，并提前告知分批时间。'),
 (2,2,4,5,5,5,TRUE,'蓝莓新鲜、果粉完整，48小时就到了。','下季希望能开放蓝莓园亲子采摘日。')
ON CONFLICT (id) DO NOTHING;
SELECT setval('callbacks_id_seq', (SELECT MAX(id) FROM callbacks));

-- 认养证书
INSERT INTO certificates (id, adoption_id, cert_no) VALUES
 (1,1,'CERT-APPLE-2026-A-0001'),
 (2,4,'CERT-BERRY-2026-A-0004')
ON CONFLICT (id) DO NOTHING;
SELECT setval('certificates_id_seq', (SELECT MAX(id) FROM certificates));

-- 直播
INSERT INTO live_streams (id, project_id, farm_id, title, stream_url, status, starts_at) VALUES
 (1,1,1,'冰雹后东坡园现场情况说明会','https://live.example.com/replay/apple-hail-0618','ended','2026-06-18 19:00:00+08'),
 (2,1,1,'红富士采摘日直播 · 带你云摘苹果','https://live.example.com/room/apple-harvest','scheduled','2026-10-21 09:00:00+08'),
 (3,4,1,'南塘稻田开镰直播','https://live.example.com/room/rice-harvest','scheduled','2026-10-08 09:30:00+08')
ON CONFLICT (id) DO NOTHING;
SELECT setval('live_streams_id_seq', (SELECT MAX(id) FROM live_streams));

-- 地块参观
INSERT INTO visits (id, plot_id, user_id, visit_date, visitors, status, note) VALUES
 (1,1,3,'2026-10-21',3,'approved','陈曦一家三人参加采摘日，农场安排午餐与摇蜜体验。')
ON CONFLICT (id) DO NOTHING;
SELECT setval('visits_id_seq', (SELECT MAX(id) FROM visits));

-- 企业团购
INSERT INTO group_buys (id, project_id, company_name, contact, phone, shares, discount_pct, status) VALUES
 (1,1,'星辰科技有限公司','周凯','13900000007',20,10.00,'fulfilled'),
 (2,2,'星辰科技有限公司','周凯','13900000007',10,5.00,'fulfilled'),
 (3,4,'明德教育集团','行政部刘老师','13900000009',80,12.00,'pending')
ON CONFLICT (id) DO NOTHING;
SELECT setval('group_buys_id_seq', (SELECT MAX(id) FROM group_buys));

-- 公益认养
INSERT INTO charity_adoptions (id, project_id, donor_name, shares, donee, message) VALUES
 (1,4,'陈曦',2,'西山敬老院','请把新米直接送到敬老院，祝老人们秋收安康。'),
 (2,4,'谷香家庭农场',10,'唐家泊镇希望小学','农场自留公益份额，新米供学校营养午餐。')
ON CONFLICT (id) DO NOTHING;
SELECT setval('charity_adoptions_id_seq', (SELECT MAX(id) FROM charity_adoptions));

-- 地块成本台账（东坡3号苹果园 · 2026 季）
INSERT INTO plot_costs (id, plot_id, project_id, season, cost_type, item, amount) VALUES
 (1,1,1,'2026','input','有机肥/豆粕/生物农药/套袋',5800.00),
 (2,1,1,'2026','disaster','冰雹防灾网维护与雹后清理',1200.00),
 (3,1,1,'2026','harvest','采摘人工（32工 × 110元 + 餐补）',3600.00),
 (4,1,1,'2026','sorting','分拣包装材料与人工',1800.00),
 (5,1,1,'2026','logistics','冷链运费（北京/上海/杭州）',2400.00),
 (6,1,1,'2026','compensation','坏果补发与企业抵扣券',600.00),
 (7,4,4,'2026','input','稻种/有机肥/灌溉',2600.00),
 (8,4,4,'2026','harvest','收割打晒人工',1500.00)
ON CONFLICT (id) DO NOTHING;
SELECT setval('plot_costs_id_seq', (SELECT MAX(id) FROM plot_costs));

-- 最终交付/结算（蓝莓季已沉淀，苹果季为进行中数据）
INSERT INTO settlements (id, project_id, batch_no, total_yield_kg, total_shipped_kg, total_sales, total_cost,
    total_compensation, avg_satisfaction, renew_rate_pct, summary) VALUES
 (2,2,'BERRY-2026-A',420.00,414.00,5139.50,3100.00,0.00,4.80,72.00,
    '本季蓝莓全园 420kg，发货 414kg（6kg 留园体验消耗），坏果率 0.4%，零赔付；团购客户复购意愿强，建议下一季扩容至 80 垄并推出亲子采摘日。'),
 (1,1,'APPLE-2026-A',2400.00,2280.00,17970.00,15400.00,859.90,4.67,85.00,
    '苹果季受冰雹影响减产约8%，保险赔付6000元覆盖大部分损失；认养箱坏果率控制在2%以内；企业客户对净重磅识提出改进，已完成口径修订。下一季建议：增设防雹网、上线净重磅识模板、试点免套袋有机份额。')
ON CONFLICT (id) DO NOTHING;
SELECT setval('settlements_id_seq', (SELECT MAX(id) FROM settlements));
