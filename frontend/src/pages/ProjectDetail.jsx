import React, { useCallback, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  get, post, KIND_EMOJI, INCIDENT_LABEL, INCIDENT_COLOR,
  fmtMoney, fmtKg, fmtDay, fmtDate,
  HAIL_OPTION_LABEL, HAIL_ALLOC_STATUS, HAIL_ALLOC_CLS, CLAIM_STATUS_LABEL,
} from '../api'
import { Tag, KindTag, ShipFlow, Modal, Empty, Stat, useToast } from '../components/ui'
import { useAuth } from '../auth'

const LOG_LABEL = { farming: '农事', fertilizer: '施肥', pesticide: '用药', disaster: '灾害', photo: '照片', other: '其他' }
const LOG_CLS = { farming: 'green', fertilizer: 'amber', pesticide: 'purple', disaster: 'red', photo: 'blue', other: 'gray' }
const PROJECT_STATUS = { ongoing: '认养中', harvesting: '采摘配送中', completed: '已结季' }

export default function ProjectDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('logs')
  const [action, setAction] = useState(null)

  const load = useCallback(() => get(`/projects/${id}`).then(setD), [id])
  useEffect(() => { load() }, [load])

  if (!d) return <Empty text="加载中…" />
  const p = d.project
  const ownFarm = user && user.farm_id === p.farm_id
  const canOperate = user && (user.role === 'admin' || ownFarm)
  const isLogistics = user && user.role === 'logistics'

  const TABS = [
    ['logs', `农事日志 (${d.logs.length})`],
    ['checks', `成熟度抽检 (${d.maturity_checks.length})`],
    ['harvest', `采摘·分拣·发货 (${d.shipments.length})`],
    ['incidents', `异常工单 (${d.incidents.length})`],
    ['hail', `🧊减产分配 (${(d.hail_allocations || []).length})`],
    ['delivery', '最终交付'],
  ]

  return (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="proj-emoji">{KIND_EMOJI[p.kind]}</div>
          <div style={{ flex: 1 }}>
            <div className="row">
              <KindTag kind={p.kind} />
              <Tag cls={p.status === 'completed' ? 'gray' : 'amber'}>{PROJECT_STATUS[p.status]}</Tag>
              {p.is_charity && <Tag cls="red">❤️ 公益认养</Tag>}
              {p.insurance_policy && <Tag cls="teal">🛡 {p.insurance_policy}</Tag>}
            </div>
            <h1 className="mt8">{p.title}</h1>
            <div className="muted small">
              {p.farm_name}（{p.farm_location}） · {p.plot_name} {p.area_mu} 亩 · 批次 {p.batch_no}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="price" style={{ fontSize: 22 }}>{fmtMoney(p.price_per_share)}</div>
            <div className="small muted">每{p.unit_name} · 保底 {p.guarantee_kg}kg</div>
            <div className="small muted mt8">已认养 {p.sold_shares}/{p.total_shares} {p.unit_name}</div>
          </div>
        </div>
        <p className="mt16">{p.description}</p>
        <div className="grid grid-3 mt8">
          <div><h3>📋 采摘标准</h3><div className="small muted">{p.harvest_standard}</div></div>
          <div><h3>🚚 配送范围</h3><div className="small muted">{p.delivery_range}</div></div>
          <div><h3>🎁 认养人权益</h3><div className="small muted">{p.rights_text}</div></div>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="预计成熟日期" value={fmtDay(p.est_mature_date)} />
        <Stat label="累计实际采摘" value={fmtKg(d.sum_harvested)} cls="amber" />
        <Stat label="累计已发货" value={fmtKg(d.sum_shipped)} cls="blue" />
        <Stat label="在途/待处理工单" value={d.incidents.filter(i => i.status !== 'resolved' && i.status !== 'compensated').length} cls="red" />
      </div>

      {canOperate && (
        <div className="card">
          <div className="section-title">农场操作</div>
          <div className="row">
            <button className="sm" onClick={() => setAction('log')}>📷 记农事/灾害</button>
            <button className="sm" onClick={() => setAction('check')}>🔬 成熟度抽检</button>
            <button className="sm" onClick={() => setAction('harvest')}>🧺 安排采摘</button>
            <button className="sm" onClick={() => setAction('sorting')}>📦 登记分拣</button>
            <button className="sm" onClick={() => setAction('shipment')}>🚚 编排发货</button>
            <button className="sm" onClick={() => setAction('cost')}>💰 地块记账</button>
            <button className="sm ghost" onClick={() => setAction('live')}>🎥 开直播</button>
            {p.status !== 'completed' && <button className="sm amber" onClick={() => setAction('settle')}>✅ 季末结算</button>}
          </div>
        </div>
      )}

      <div className="card">
        <div className="tabs">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>

        {tab === 'logs' && (
          <div className="timeline">
            {d.logs.map((l) => (
              <div key={l.id} className={'tl-item' + (l.log_type === 'disaster' ? ' disaster' : '')}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{l.title}</strong>
                  <span>
                    <Tag cls={LOG_CLS[l.log_type]}>{LOG_LABEL[l.log_type]}</Tag>
                    {l.disaster_kind && <Tag cls="red">{l.disaster_kind} · 影响约 {l.yield_impact_pct}%</Tag>}
                  </span>
                </div>
                <div className="small">{l.content}</div>
                {l.photos?.length > 0 && (
                  <div className="small muted mt8">📷 {l.photos.map((x) => x.caption).join('、')}</div>
                )}
                <div className="tl-time">{l.author_name} · {fmtDate(l.created_at)}</div>
              </div>
            ))}
          </div>
        )}

        {tab === 'checks' && (
          <>
            <table>
              <thead><tr><th>抽检时间</th><th>糖度</th><th>样本</th><th>成熟度</th><th>预估产量</th><th>坏果率</th><th>分级</th><th>备注</th></tr></thead>
              <tbody>
                {d.maturity_checks.map((c) => (
                  <tr key={c.id}>
                    <td>{fmtDate(c.checked_at)}</td>
                    <td>{c.brix ?? '—'}</td>
                    <td>{c.sample_count}</td>
                    <td><Tag cls={c.maturity_pct >= 90 ? 'green' : 'amber'}>{c.maturity_pct}%</Tag></td>
                    <td>{fmtKg(c.est_yield_kg)}</td>
                    <td className={c.bad_rate_pct > 4 ? '' : ''} style={{ color: c.bad_rate_pct > 4 ? 'var(--red)' : undefined }}>
                      {c.bad_rate_pct}%
                    </td>
                    <td className="small">{Object.entries(c.grade_dist || {}).map(([k, v]) => `${k} ${v}%`).join(' / ')}</td>
                    <td className="small muted">{c.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.maturity_checks.length === 0 && <Empty />}
          </>
        )}

        {tab === 'harvest' && (
          <div>
            <h3>🧺 采摘任务</h3>
            <table>
              <thead><tr><th>计划日期</th><th>优先级</th><th>采摘工</th><th>目标</th><th>实际</th><th>坏果率</th><th>状态</th>
                  {user && (user.role === 'picker' || canOperate) && <th>操作</th>}</tr></thead>
              <tbody>
                {d.harvest_tasks.map((h) => (
                  <tr key={h.id}>
                    <td>{fmtDay(h.planned_date)}</td>
                    <td>{h.priority}</td>
                    <td>{h.picker_name || '未分配'}</td>
                    <td>{fmtKg(h.target_kg)}</td>
                    <td>{h.actual_kg != null ? fmtKg(h.actual_kg) : '—'}</td>
                    <td>{h.bad_rate_pct != null ? h.bad_rate_pct + '%' : '—'}</td>
                    <td><Tag cls={h.status === 'done' ? 'gray' : 'amber'}>{h.status === 'done' ? '已完成' : '待采摘'}</Tag></td>
                    <td>
                      {h.status !== 'done' && (user.role === 'picker' || canOperate) && (
                        <button className="sm ghost" onClick={() => setAction({ type: 'harvest_done', task: h })}>回填</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.harvest_tasks.length === 0 && <Empty text="暂无采摘任务" />}

            <h3 className="mt16">📦 分拣记录（包装规格）</h3>
            <table>
              <thead><tr><th>规格</th><th>重量</th><th>箱数</th><th>包装员</th><th>时间</th></tr></thead>
              <tbody>
                {d.sorting.map((s) => (
                  <tr key={s.id}><td>{s.spec}</td><td>{fmtKg(s.weight_kg)}</td><td>{s.box_count}</td>
                    <td>{s.packer_name}</td><td>{fmtDate(s.created_at)}</td></tr>
                ))}
              </tbody>
            </table>
            {d.sorting.length === 0 && <Empty text="暂无分拣记录" />}

            <h3 className="mt16">🚚 分批发货与冷链</h3>
            <table>
              <thead><tr><th>批次</th><th>计划</th><th>规格</th><th>重量</th><th>冷链路线</th><th>状态</th><th>运单号</th><th>坏果率</th><th>收货人</th>
                {(canOperate || isLogistics) && <th>操作</th>}</tr></thead>
              <tbody>
                {d.shipments.map((s) => (
                  <tr key={s.id}>
                    <td>第 {s.seq} 批</td>
                    <td>{fmtDay(s.plan_date)}</td>
                    <td className="small">{s.pack_spec}</td>
                    <td>{s.weight_kg != null ? fmtKg(s.weight_kg) : '—'}</td>
                    <td className="small">{s.cold_route || '—'}</td>
                    <td><ShipFlow status={s.status} /></td>
                    <td className="small">{s.tracking_no || '—'}</td>
                    <td style={{ color: s.bad_fruit_rate > 4 ? 'var(--red)' : undefined }}>{s.status === 'planned' ? '—' : s.bad_fruit_rate + '%'}</td>
                    <td className="small">{s.recipient_name || '—'}</td>
                    <td>
                      {(canOperate || isLogistics) && s.status !== 'delivered' && (
                        <button className="sm ghost" onClick={() => setAction({ type: 'ship_advance', ship: s })}>推进</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.shipments.length === 0 && <Empty text="暂无发货计划" />}
          </div>
        )}

        {tab === 'incidents' && (
          <div className="grid grid-2">
            {d.incidents.map((i) => (
              <Link key={i.id} to={`/incidents?focus=${i.id}`} className="card" style={{ color: 'inherit', display: 'block' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <Tag cls={i.status === 'compensated' ? 'green' : i.status === 'resolved' ? 'gray' : 'red'}>
                    {i.status === 'open' ? '待处理' : i.status === 'processing' ? '处理中' : i.status === 'resolved' ? '已解决' : '已赔付'}
                  </Tag>
                  <span className="tag" style={{ background: '#fef2f2', color: INCIDENT_COLOR[i.kind], borderColor: '#fecaca' }}>
                    {INCIDENT_LABEL[i.kind]}
                  </span>
                </div>
                <h3 className="mt8">{i.title}</h3>
                <div className="small muted">{i.description}</div>
                <div className="tl-time mt8">{i.reporter_name} · {fmtDate(i.created_at)}</div>
              </Link>
            ))}
            {d.incidents.length === 0 && <Empty text="本批次无异常" />}
          </div>
        )}

        {tab === 'hail' && <HailTab d={d} canOperate={canOperate} canService={user && ['service', 'admin'].includes(user.role)} onDone={load} />}

        {tab === 'delivery' && <DeliveryTab d={d} />}
      </div>

      {action && <ActionModal kind={action} projectId={p.id} onClose={() => setAction(null)} onDone={load} />}
    </>
  )
}

// 冰雹减产分配 Tab：方案、选择进度、客服确认、最终确认
function HailTab({ d, canOperate, canService, onDone }) {
  const toast = useToast()
  const allocs = d.hail_allocations || []
  const [detailId, setDetailId] = useState(allocs[0]?.id || null)
  const [detail, setDetail] = useState(null)
  const [creating, setCreating] = useState(false)
  const loadDetail = (id) => get(`/hail-allocations/${id}`).then(setDetail)
  useEffect(() => { if (detailId) loadDetail(detailId).catch(() => {}) }, [detailId])
  const refresh = () => { onDone(); if (detailId) loadDetail(detailId) }

  if (allocs.length === 0 && !canOperate && !canService) return <Empty text="本批次暂无冰雹减产分配方案" />

  return (
    <div>
      <div className="row">
        <h3 style={{ margin: 0 }}>🧊 冰雹减产分配</h3>
        <span className="spacer" />
        {(canOperate || canService) && <button className="sm" onClick={() => setCreating(true)}>+ 记录减产分配方案</button>}
      </div>
      <p className="muted small mt8">平台记录受灾照片、保险报案、可采果数量与补偿方案；认养人三选一（延期/换品类/按比例退款），确认后证书与到货时间更新、农场续认信用同步。</p>

      {allocs.length > 0 && (
        <>
          <div className="row mt8">
            {allocs.map((a) => (
              <button key={a.id} className={'sm ' + (a.id === detailId ? '' : 'ghost')} onClick={() => setDetailId(a.id)}>
                方案#{a.id} {HAIL_ALLOC_STATUS[a.status]}
              </button>
            ))}
          </div>
          {detail && <HailAdminDetail detail={detail} canOperate={canOperate} canService={canService} onChanged={refresh} />}
        </>
      )}
      {creating && <HailCreateModal projectId={d.project.id} onClose={() => setCreating(false)} onDone={() => { setCreating(false); onDone() }} />}
    </div>
  )
}

function HailAdminDetail({ detail, canOperate, canService, onChanged }) {
  const toast = useToast()
  const al = detail.allocation
  const choices = detail.choices || []
  const credit = detail.renew_credit
  const pendingService = choices.filter((c) => c.option === 'switch' && c.service_status === 'pending')
  const pendingBatch = choices.filter((c) => c.option === 'switch' && c.service_status === 'confirmed' && c.batch_status !== 'confirmed')
  const canConfirm = canOperate && al.status !== 'confirmed' && al.status !== 'closed' &&
    pendingService.length === 0 && pendingBatch.length === 0 && choices.length > 0

  const serviceConfirm = async (cid, status) => {
    try {
      await post(`/hail-choices/${cid}/service`, { status, service_note: status === 'confirmed' ? '客服核对库存与档期，确认换品类，结果已同步客服组' : '库存不足，建议选择其他方式' })
      toast(status === 'confirmed' ? '已确认换品类，等待认养人重新确认配送批次' : '已驳回')
      onChanged()
    } catch (e) { toast(e.message, true) }
  }
  const finalConfirm = async () => {
    try {
      const r = await post(`/hail-allocations/${al.id}/confirm`, {})
      toast('减产分配已确认：证书换发、ETA 更新、退款出账、续认信用同步')
      onChanged()
    } catch (e) { toast(e.message, true) }
  }

  const shortage = Math.max(0, Number(al.committed_kg || 0) - Number(al.pickable_kg || 0))
  return (
    <div className="card mt16" style={{ background: '#fffbeb' }}>
      <div className="row">
        <strong>{al.title}</strong>
        <Tag cls={HAIL_ALLOC_CLS[al.status]}>{HAIL_ALLOC_STATUS[al.status]}</Tag>
        {al.insurance_status && <Tag cls={al.insurance_status === 'settled' ? 'green' : 'amber'}>
          保险：{CLAIM_STATUS_LABEL[al.insurance_status] || al.insurance_status}{al.insurance_amount ? ` ¥${al.insurance_amount}` : ''}
        </Tag>}
      </div>
      <div className="grid grid-4 mt16">
        <Stat label="承诺总量" value={fmtKg(al.committed_kg)} />
        <Stat label="可采果" value={fmtKg(al.pickable_kg)} cls="amber" />
        <Stat label="缺口" value={fmtKg(shortage)} cls="red" />
        <Stat label="建议退款比例" value={al.refund_pct + '%'} cls="red" />
      </div>
      {al.photos?.length > 0 && <div className="small muted mt8">📷 {al.photos.map((p) => p.caption).join('、')}</div>}
      <p className="small mt8">{al.compensation_plan}</p>

      <div className="section-title mt16">认养人选择（{choices.length} 笔）</div>
      <table>
        <thead><tr><th>订单</th><th>认养人</th><th>份数</th><th>选择</th><th>换品类/退款/ETA</th><th>客服</th><th>配送批次</th><th>状态</th>{canService && <th>操作</th>}</tr></thead>
        <tbody>
          {choices.map((c) => (
            <tr key={c.id}>
              <td>#{c.adoption_id}</td>
              <td>{c.user_name}</td>
              <td>{c.shares}</td>
              <td><Tag cls={c.option === 'switch' ? 'purple' : c.option === 'refund' ? 'red' : 'blue'}>{HAIL_OPTION_LABEL[c.option]}</Tag></td>
              <td className="small">
                {c.option === 'switch' && <>{c.switch_title}<br /><span className="muted">约 {c.switch_kg}kg · 预计 {fmtDay(c.eta_date)}</span></>}
                {c.option === 'refund' && <span className="muted">{c.refund_pct}% · {fmtMoney(c.refund_amount)}</span>}
                {c.option === 'delay' && <span className="muted">延期至 {fmtDay(c.eta_date)}</span>}
              </td>
              <td>{c.service_status === 'confirmed' ? <Tag cls="green">已确认</Tag>
                : c.service_status === 'rejected' ? <Tag cls="red">已驳回</Tag>
                : c.service_status === 'pending' ? <Tag cls="amber">待确认</Tag> : '—'}</td>
              <td>{c.batch_status === 'confirmed' ? <Tag cls="green">已确认</Tag>
                : c.batch_status === 'pending' ? <Tag cls="red">待重确认</Tag> : '—'}</td>
              <td>{c.status === 'confirmed' ? <Tag cls="green">已确认</Tag> : <Tag cls="amber">待确认</Tag>}</td>
              {canService && (
                <td>
                  {c.option === 'switch' && c.service_status === 'pending' && (
                    <div className="row">
                      <button className="sm" onClick={() => serviceConfirm(c.id, 'confirmed')}>确认</button>
                      <button className="sm ghost" onClick={() => serviceConfirm(c.id, 'rejected')}>驳回</button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {choices.length === 0 && <Empty text="认养人尚未作出选择" />}

      <div className="row mt16">
        {pendingService.length > 0 && <Tag cls="amber">{pendingService.length} 笔换品类待客服确认</Tag>}
        {pendingBatch.length > 0 && <Tag cls="red">{pendingBatch.length} 笔待认养人重新确认配送批次</Tag>}
        <span className="spacer" />
        {canConfirm && <button className="sm amber" onClick={finalConfirm}>✓ 确认减产分配（证书换发+ETA+退款+信用）</button>}
      </div>

      {credit && (
        <div className="card mt16" style={{ background: '#f0fdf4' }}>
          <div className="row">
            <strong>农场续认信用（{credit.season} 季）</strong>
            <Tag cls={credit.level === 'A' ? 'green' : 'amber'}>{credit.level} 级守信农场</Tag>
            <span className="spacer" />
            <strong style={{ fontSize: 20 }}>{Number(credit.score).toFixed(0)} 分</strong>
          </div>
          <div className="grid grid-4 mt8">
            <Stat label="冰雹处置次数" value={credit.hail_handled} />
            <Stat label="延期份额" value={credit.delayed_shares} cls="blue" />
            <Stat label="换品类份额" value={credit.switched_shares} cls="purple" />
            <Stat label="退款份额" value={credit.refunded_shares} cls="red" />
          </div>
          <p className="small muted mt8">{credit.note}</p>
        </div>
      )}
    </div>
  )
}

function HailCreateModal({ projectId, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({
    title: '', pickable_kg: 0, refund_pct: 0,
    delay_eta: '2026-11-05', delay_note: '', delay_bonus: 1,
    switch_json: '[{"kind":"blueberry","title":"优瑞卡蓝莓鲜果礼盒2盒（约3斤）","kg_equiv":1.5,"eta_date":"2026-11-10"}]',
    photos_text: '[{"caption":"雹后落果","url":"/static/demo/hail1.jpg"}]',
    compensation_plan: '',
  })
  const set = (k, v) => setF({ ...f, [k]: v })
  const submit = async () => {
    if (!f.title || !f.pickable_kg) return toast('标题与可采果数量必填', true)
    let photos = [], switchOption = []
    try { photos = f.photos_text ? JSON.parse(f.photos_text) : [] } catch { return toast('受灾照片 JSON 格式错误', true) }
    try { switchOption = f.switch_json ? JSON.parse(f.switch_json) : [] } catch { return toast('换品类 JSON 格式错误', true) }
    try {
      await post('/hail-allocations', {
        project_id: projectId, title: f.title, pickable_kg: Number(f.pickable_kg),
        refund_pct: Number(f.refund_pct) || undefined, photos,
        delay_option: { eta_date: f.delay_eta, note: f.delay_note, bonus_kg: Number(f.delay_bonus) || 0 },
        switch_option: switchOption, compensation_plan: f.compensation_plan,
      })
      toast('减产分配方案已记录，认养人可开始三选一'); onDone()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title="记录冰雹减产分配方案" onClose={onClose} wide>
      <div className="grid grid-2">
        <div><label>方案标题</label><input value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="如：东坡3号苹果园冰雹减产分配方案" /></div>
        <div><label>可采果数量 kg</label><input type="number" value={f.pickable_kg} onChange={(e) => set('pickable_kg', Number(e.target.value))} /></div>
        <div><label>建议退款比例 %（留空自动按缺口算）</label><input type="number" value={f.refund_pct} onChange={(e) => set('refund_pct', Number(e.target.value))} /></div>
        <div><label>延期预计到货日期</label><input type="date" value={f.delay_eta} onChange={(e) => set('delay_eta', e.target.value)} /></div>
        <div><label>延期加送 kg</label><input type="number" step="0.5" value={f.delay_bonus} onChange={(e) => set('delay_bonus', Number(e.target.value))} /></div>
      </div>
      <label>延期说明</label><input value={f.delay_note} onChange={(e) => set('delay_note', e.target.value)} />
      <label>换品类选项（JSON）</label><textarea rows="2" value={f.switch_json} onChange={(e) => set('switch_json', e.target.value)} />
      <label>受灾照片（JSON）</label><textarea rows="2" value={f.photos_text} onChange={(e) => set('photos_text', e.target.value)} />
      <label>补偿方案说明</label><textarea rows="3" value={f.compensation_plan} onChange={(e) => set('compensation_plan', e.target.value)}
        placeholder="保险理赔到账金额、缺口折算、三选一说明、未足额部分承担方…" />
      <button className="mt16" onClick={submit}>记录方案并通知认养人</button>
    </Modal>
  )
}

function DeliveryTab({ d }) {
  const st = d.settlement
  const claims = d.insurance_claims || []
  return (
    <>
      {st ? (
        <div className="card" style={{ background: '#fafdf7' }}>
          <div className="section-title">📜 最终交付记录</div>
          <div className="grid grid-4">
            <Stat label="实际总产量" value={fmtKg(st.total_yield_kg)} />
            <Stat label="总发货量" value={fmtKg(st.total_shipped_kg)} cls="blue" />
            <Stat label="销售总额" value={fmtMoney(st.total_sales)} cls="amber" />
            <Stat label="总赔付" value={fmtMoney(st.total_compensation)} cls="red" />
            <Stat label="地块总成本" value={fmtMoney(st.total_cost)} />
            <Stat label="平均满意度" value={st.avg_satisfaction ? st.avg_satisfaction + ' / 5' : '—'} />
            <Stat label="续认率" value={st.renew_rate_pct != null ? st.renew_rate_pct + '%' : '—'} cls="amber" />
            <Stat label="批次" value={st.batch_no} />
          </div>
          <p className="mt16">{st.summary}</p>
        </div>
      ) : (
        <Empty text="本季尚未结算" />
      )}
      <h3 className="mt16">🛡 保险理赔</h3>
      <table>
        <thead><tr><th>保单号</th><th>类型</th><th>损失</th><th>理赔额</th><th>状态</th><th>备注</th></tr></thead>
        <tbody>
          {claims.map((c) => (
            <tr key={c.id}><td>{c.policy_no}</td><td>{c.kind}</td><td>{fmtKg(c.loss_kg)}</td>
              <td>{fmtMoney(c.amount)}</td><td><Tag cls={c.status === 'settled' ? 'green' : 'amber'}>{c.status}</Tag></td>
              <td className="small muted">{c.note}</td></tr>
          ))}
        </tbody>
      </table>
      {claims.length === 0 && <Empty text="暂无理赔记录" />}
    </>
  )
}

// ---------- 操作弹窗 ----------
function ActionModal({ kind, projectId, onClose, onDone }) {
  const toast = useToast()
  const simple = typeof kind === 'string'
  const type = simple ? kind : kind.type
  const titles = {
    log: '记录农事 / 灾害', check: '成熟度抽检', harvest: '安排采摘任务', sorting: '登记分拣',
    shipment: '编排序批发货', cost: '地块记账', live: '创建直播', settle: '季末结算',
  }
  const [f, setF] = useState({})
  const set = (k, v) => setF({ ...f, [k]: v })
  const submit = async () => {
    try {
      await dispatchAction(type, projectId, f, kind.task || kind.ship)
      toast('操作成功')
      onDone()
      onClose()
    } catch (e) {
      toast(e.message, true)
    }
  }
  return (
    <Modal title={titles[type] || '操作'} onClose={onClose}>
      {type === 'log' && (
        <>
          <label>类型</label>
          <select onChange={(e) => set('log_type', e.target.value)} defaultValue="farming">
            <option value="farming">农事</option><option value="fertilizer">施肥</option>
            <option value="pesticide">用药</option><option value="disaster">⚠️ 天气灾害</option>
            <option value="photo">照片</option><option value="other">其他</option>
          </select>
          <label>标题</label><input onChange={(e) => set('title', e.target.value)} placeholder="如：遭遇冰雹灾害" />
          <label>内容</label><textarea rows="3" onChange={(e) => set('content', e.target.value)} />
          {f.log_type === 'disaster' && (
            <div className="grid grid-2">
              <div><label>灾害类型</label><input onChange={(e) => set('disaster_kind', e.target.value)} placeholder="冰雹/连阴雨/大风…" /></div>
              <div><label>预估产量影响 %</label><input type="number" onChange={(e) => set('yield_impact_pct', Number(e.target.value))} /></div>
            </div>
          )}
        </>
      )}
      {type === 'check' && (
        <div className="grid grid-2">
          <div><label>糖度</label><input type="number" step="0.1" onChange={(e) => set('brix', Number(e.target.value))} /></div>
          <div><label>样本数</label><input type="number" onChange={(e) => set('sample_count', Number(e.target.value))} /></div>
          <div><label>成熟度 %</label><input type="number" onChange={(e) => set('maturity_pct', Number(e.target.value))} /></div>
          <div><label>预估产量 kg</label><input type="number" onChange={(e) => set('est_yield_kg', Number(e.target.value))} /></div>
          <div><label>坏果率 %</label><input type="number" step="0.1" onChange={(e) => set('bad_rate_pct', Number(e.target.value))} /></div>
          <div><label>分级（JSON）</label><input defaultValue='{"large":55,"mid":35,"small":10}' onChange={(e) => { try { set('grade_dist', JSON.parse(e.target.value)) } catch {} }} /></div>
          <div style={{ gridColumn: '1/-1' }}><label>备注</label><input onChange={(e) => set('notes', e.target.value)} /></div>
        </div>
      )}
      {type === 'harvest' && (
        <div className="grid grid-2">
          <div><label>采摘工 ID</label><input type="number" onChange={(e) => set('picker_id', Number(e.target.value))} /></div>
          <div><label>优先级（越小越优先）</label><input type="number" defaultValue={100} onChange={(e) => set('priority', Number(e.target.value))} /></div>
          <div><label>计划日期</label><input type="date" onChange={(e) => set('planned_date', e.target.value)} /></div>
          <div><label>目标产量 kg</label><input type="number" onChange={(e) => set('target_kg', Number(e.target.value))} /></div>
        </div>
      )}
      {type === 'harvest_done' && (
        <div className="grid grid-2">
          <div><label>实际采摘 kg</label><input type="number" onChange={(e) => set('actual_kg', Number(e.target.value))} /></div>
          <div><label>坏果率 %</label><input type="number" step="0.1" onChange={(e) => set('bad_rate_pct', Number(e.target.value))} /></div>
        </div>
      )}
      {type === 'sorting' && (
        <div className="grid grid-3">
          <div style={{ gridColumn: '1/-1' }}><label>包装规格</label><input onChange={(e) => set('spec', e.target.value)} placeholder="如：精品大果80-85mm/12枚装" /></div>
          <div><label>重量 kg</label><input type="number" onChange={(e) => set('weight_kg', Number(e.target.value))} /></div>
          <div><label>箱数</label><input type="number" onChange={(e) => set('box_count', Number(e.target.value))} /></div>
        </div>
      )}
      {type === 'shipment' && (
        <>
          <div className="grid grid-2">
            <div><label>认养订单 ID</label><input type="number" onChange={(e) => set('adoption_id', Number(e.target.value))} /></div>
            <div><label>第几批</label><input type="number" defaultValue={1} onChange={(e) => set('seq', Number(e.target.value))} /></div>
            <div><label>计划日期</label><input type="date" onChange={(e) => set('plan_date', e.target.value)} /></div>
            <div><label>重量 kg</label><input type="number" onChange={(e) => set('weight_kg', Number(e.target.value))} /></div>
          </div>
          <label>包装规格</label><input onChange={(e) => set('pack_spec', e.target.value)} />
          <label>冷链路线</label><input onChange={(e) => set('cold_route', e.target.value)} placeholder="烟台-济南分拨-北京（全程0-4℃）" />
        </>
      )}
      {type === 'ship_advance' && (
        <ShipAdvanceForm ship={kind.ship} />
      )}
      {type === 'cost' && (
        <div className="grid grid-2">
          <div><label>成本类型</label>
            <select onChange={(e) => set('cost_type', e.target.value)} defaultValue="">
              <option value="" disabled>请选择</option>
              <option value="input">农事投入</option><option value="disaster">防灾/灾害</option>
              <option value="harvest">采摘人工</option><option value="sorting">分拣包装</option>
              <option value="logistics">冷链物流</option><option value="compensation">赔付</option>
            </select>
          </div>
          <div><label>金额 ¥</label><input type="number" onChange={(e) => set('amount', Number(e.target.value))} /></div>
          <div style={{ gridColumn: '1/-1' }}><label>事项</label><input onChange={(e) => set('item', e.target.value)} /></div>
        </div>
      )}
      {type === 'live' && (
        <>
          <label>直播标题</label><input onChange={(e) => set('title', e.target.value)} />
          <label>推流/回放地址</label><input onChange={(e) => set('stream_url', e.target.value)} placeholder="https://live.example.com/…" />
          <label>开始时间</label><input type="datetime-local" onChange={(e) => set('starts_at', e.target.value)} />
        </>
      )}
      {type === 'settle' && (
        <>
          <p className="muted">系统将自动汇总实际采摘、发货、销售额、成本、赔付、满意度与续认率。可补充本季总结与下一季建议。</p>
          <label>季度总结 / 下一季续认建议</label>
          <textarea rows="4" onChange={(e) => set('summary', e.target.value)} placeholder="如：本季受冰雹影响…建议增设防雹网、上线净重磅识模板…" />
        </>
      )}
      {type !== 'ship_advance' && <div className="mt16"><button onClick={submit}>提交</button></div>}
    </Modal>
  )
}

function ShipAdvanceForm({ ship }) {
  const toast = useToast()
  const next = { planned: 'picked', picked: 'packed', packed: 'shipped', shipped: 'delivered' }[ship.status]
  const label = { picked: '确认已采摘', packed: '确认已包装', shipped: '物流发车', delivered: '确认送达' }[next]
  const [f, setF] = useState({ status: next })
  return (
    <>
      <p>当前：<ShipFlow status={ship.status} />，下一步：<strong>{label}</strong></p>
      {next === 'shipped' && (
        <div className="grid grid-2">
          <div><label>物流公司</label><input onChange={(e) => setF({ ...f, logistics_company: e.target.value })} /></div>
          <div><label>运单号</label><input onChange={(e) => setF({ ...f, tracking_no: e.target.value })} /></div>
          <div style={{ gridColumn: '1/-1' }}><label>发货坏果率 %</label><input type="number" step="0.1" onChange={(e) => setF({ ...f, bad_fruit_rate: Number(e.target.value) })} /></div>
        </div>
      )}
      <button className="mt16" onClick={async () => {
        try { await post(`/projects/${ship.project_id}/shipments/${ship.id}/advance`, f); toast('状态已推进'); location.reload() }
        catch (e) { toast(e.message, true) }
      }}>{label}</button>
    </>
  )
}

async function dispatchAction(type, projectId, f, extra) {
  if (type === 'harvest_done') return post(`/projects/${projectId}/harvests/${extra.id}/complete`, f)
  const paths = {
    log: 'logs', check: 'checks', harvest: 'harvests', sorting: 'sorting',
    shipment: 'shipments', cost: 'costs', live: 'live', settle: 'settle',
  }
  return post(`/projects/${projectId}/${paths[type]}`, f)
}
