import React, { useCallback, useEffect, useState } from 'react'
import { get, post, KIND_EMOJI, fmtMoney, fmtKg, fmtDay, fmtDate, SHIP_STATUS_LABEL,
  HAIL_OPTION_LABEL, HAIL_OPTION_DESC, HAIL_ALLOC_STATUS, HAIL_ALLOC_CLS, CLAIM_STATUS_LABEL } from '../api'
import { Tag, ShipFlow, Modal, Empty, Stat, useToast } from '../components/ui'

const ORDER_STATUS = { paid: '待发货', shipping: '履约中', completed: '已完成', refunded: '已退款' }
const COMP_LABEL = { cash: '现金赔付', reship: '补发', insurance: '保险赔付', credit: '下季抵扣' }
const COMP_CLS = { cash: 'red', reship: 'amber', insurance: 'teal', credit: 'purple' }

export default function MyAdoptions() {
  const [list, setList] = useState([])
  const [focus, setFocus] = useState(null) // address / callback / cert / hail / hail-batch
  const [cur, setCur] = useState(null)
  const load = useCallback(() => get('/my/adoptions').then(setList), [])
  useEffect(() => { load() }, [load])

  return (
    <>
      <h1>🎁 我的认养与权益兑现</h1>
      <p className="muted">每一份认养的保底产量、分批发货、赔付折算与满意度回访都在这里核对——看自己的权益是否被公平兑现。</p>
      {list.length === 0 ? <Empty text="还没有认养记录，去首页挑一块好地吧" /> : (
        <div className="grid">
          {list.map((a) => {
            const rf = a.rights_fulfillment
            return (
              <div key={a.id} className="card">
                <div className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="proj-emoji">{KIND_EMOJI[a.kind]}</div>
                  <div style={{ flex: 1 }}>
                    <div className="row">
                      <h2 style={{ margin: 0 }}>{a.title}</h2>
                      <Tag cls={a.status === 'completed' ? 'gray' : 'amber'}>{ORDER_STATUS[a.status]}</Tag>
                      <Tag cls="blue">批次 {a.batch_no}</Tag>
                      <Tag>{a.shares} {a.unit_name || '份'}</Tag>
                    </div>
                    <div className="small muted mt8">{a.farm_name} · 订单号 #{a.id} · {fmtMoney(a.amount)}</div>
                    {a.eta_date && (
                      <div className="small mt8" style={{ color: '#0369a1' }}>
                        🚚 预计到货时间：<strong>{fmtDay(a.eta_date)}</strong>
                        {a.hail_choice && <span className="muted">（冰雹减产分配后更新）</span>}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {rf.fair
                      ? <span className="badge-fair ok">✓ 权益已公平兑现</span>
                      : rf.projected_fair
                        ? <span className="badge-fair warn">⏳ 在途批次兑现中</span>
                        : <span className="badge-fair warn">⚠ 保底权益存在缺口</span>}
                    <div className="small muted mt8">{rf.stage}</div>
                  </div>
                </div>

                <div className="grid grid-4 mt16">
                  <Stat label="保底产量" value={fmtKg(rf.guarantee_kg)} />
                  <Stat label="已收到" value={fmtKg(rf.shipped_kg)} cls="blue" />
                  <Stat label="在途/待发" value={fmtKg(rf.planned_kg)} cls="amber" />
                  <Stat label="赔付折算" value={fmtKg(rf.compensated_kg_equiv)} cls={rf.compensated_kg_equiv > 0 ? 'red' : ''} />
                </div>

                {a.hail_allocation && (
                  <HailPanel adoption={a} onChanged={load}
                    onOpen={(f) => { setCur(a); setFocus(f) }} />
                )}

                <div className="grid grid-2 mt16">
                  <div>
                    <h3>🚚 分批发货计划</h3>
                    <table>
                      <thead><tr><th>批次</th><th>计划</th><th>规格/路线</th><th>状态</th></tr></thead>
                      <tbody>
                        {(a.shipments || []).map((s) => (
                          <tr key={s.id || s.seq}>
                            <td>第{s.seq}批<br /><span className="small muted">{s.weight_kg}kg</span></td>
                            <td>{fmtDay(s.plan_date)}</td>
                            <td className="small">{s.pack_spec}<br /><span className="muted">{s.cold_route}</span><br />
                              {s.tracking_no && <span className="muted">运单 {s.tracking_no}</span>}</td>
                            <td><ShipFlow status={s.status} /></td>
                          </tr>
                        ))}
                        {(!a.shipments || a.shipments.length === 0) && <tr><td colSpan="4" className="muted">尚未排产</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <h3>💰 赔付与售后</h3>
                    {(a.compensations || []).length === 0 ? <Empty text="暂无赔付记录" /> : (
                      <table>
                        <thead><tr><th>事项</th><th>方式</th><th>金额</th><th>状态</th></tr></thead>
                        <tbody>
                          {a.compensations.map((c) => (
                            <tr key={c.id || c.note}>
                              <td className="small">{c.incident_title}<br /><span className="muted">{c.note}</span></td>
                              <td><Tag cls={COMP_CLS[c.kind]}>{COMP_LABEL[c.kind]}</Tag></td>
                              <td>{fmtMoney(c.amount)}</td>
                              <td>{c.status === 'paid' ? '已到账' : '处理中'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <h3 className="mt16">⭐ 我的回访</h3>
                    {(a.callbacks || []).length === 0 ? <Empty text="尚未回访" /> : a.callbacks.map((c) => (
                      <div key={c.id} className="small">
                        满意度 {'★'.repeat(c.satisfaction)}{'☆'.repeat(5 - c.satisfaction)}
                        （品质 {c.quality_score}/5 · 配送 {c.delivery_score}/5）
                        {c.would_renew && <Tag cls="green">愿续认</Tag>}
                        <div className="muted">“{c.comment}”</div>
                        <div className="muted">续认建议：{c.renew_suggestion}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="row mt16">
                  {a.cert_no && <button className="sm ghost" onClick={() => setCur(a) || setFocus('cert')}>🏆 查看认养证书{(a.cert_version || 1) > 1 && ` v${a.cert_version}`}</button>}
                  {a.status !== 'completed' && (
                    <button className="sm ghost" onClick={() => { setCur(a); setFocus('address') }}>📍 申请改地址</button>
                  )}
                  {(a.callbacks || []).length === 0 && a.status === 'completed' && (
                    <button className="sm" onClick={() => { setCur(a); setFocus('callback') }}>📝 成熟度回访</button>
                  )}
                  <span className="spacer" />
                  <span className="small muted">收货：{a.recipient_name} {a.phone} · {a.address}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {focus === 'address' && cur && <AddressModal adoption={cur} onClose={() => setFocus(null)} onDone={load} />}
      {focus === 'callback' && cur && <CallbackModal adoption={cur} onClose={() => setFocus(null)} onDone={load} />}
      {focus === 'cert' && cur && <CertModal adoption={cur} onClose={() => setFocus(null)} />}
      {focus === 'hail' && cur && <HailChooseModal adoption={cur} onClose={() => setFocus(null)} onDone={load} />}
      {focus === 'hail-batch' && cur && <HailBatchModal adoption={cur} onClose={() => setFocus(null)} onDone={load} />}
    </>
  )
}

// 冰雹减产分配面板：理赔状态、可采果数量、补偿方案、三选一、换品类两阶段确认
function HailPanel({ adoption, onChanged, onOpen }) {
  const [showPlan, setShowPlan] = useState(false)
  const al = adoption.hail_allocation
  const ch = adoption.hail_choice

  const shortage = Math.max(0, Number(al.committed_kg || 0) - Number(al.pickable_kg || 0))
  const pct = al.committed_kg > 0 ? ((shortage / al.committed_kg) * 100).toFixed(1) : '0'
  const delayEta = al.delay_option?.eta_date
  const switchList = Array.isArray(al.switch_option) ? al.switch_option : []
  const confirmed = al.status === 'confirmed' || al.status === 'closed'

  return (
    <div className="card mt16" style={{ background: '#fffbeb', borderColor: '#fcd34d' }}>
      <div className="row">
        <Tag cls={HAIL_ALLOC_CLS[al.status]}>🧊 冰雹减产分配 · {HAIL_ALLOC_STATUS[al.status]}</Tag>
        {al.insurance_status && (
          <Tag cls={al.insurance_status === 'settled' ? 'green' : 'amber'}>
            🛡 保险理赔：{CLAIM_STATUS_LABEL[al.insurance_status] || al.insurance_status}
            {al.insurance_amount ? ` ¥${Number(al.insurance_amount).toLocaleString()}` : ''}
          </Tag>
        )}
        <span className="spacer" />
        <button className="sm ghost" onClick={() => setShowPlan(!showPlan)}>
          {showPlan ? '收起补偿方案' : '查看补偿方案'}
        </button>
      </div>

      <div className="grid grid-4 mt16">
        <Stat label="认养承诺总量" value={fmtKg(al.committed_kg)} />
        <Stat label="可采果数量" value={fmtKg(al.pickable_kg)} cls="amber" />
        <Stat label="预计缺口" value={fmtKg(shortage)} cls="red" />
        <Stat label="缺口比例" value={pct + '%'} cls="red" />
      </div>

      {showPlan && (
        <>
          {al.photos?.length > 0 && (
            <div className="small muted mt8">📷 受灾照片：{al.photos.map((p) => p.caption).join('、')}</div>
          )}
          <p className="small mt8">{al.compensation_plan}</p>
          <div className="grid grid-3 mt8">
            <div className="small">
              <Tag cls="blue">① 延期交付</Tag>
              <div className="muted mt8">
                {delayEta ? `预计 ${delayEta} 到货` : '—'}
                {al.delay_option?.bonus_kg ? `，加送 ${al.delay_option.bonus_kg}kg` : ''}
                <br />{al.delay_option?.note}
              </div>
            </div>
            <div className="small">
              <Tag cls="purple">② 换品类</Tag>
              <div className="muted mt8">
                {switchList.length ? switchList.map((s) => `${s.title}（预计 ${s.eta_date}）`).join('；') : '暂无可换品类'}
              </div>
            </div>
            <div className="small">
              <Tag cls="red">③ 按比例退款</Tag>
              <div className="muted mt8">建议退款比例 <strong>{al.refund_pct}%</strong>，原路退回，约 {fmtMoney((adoption.amount || 0) * (al.refund_pct || 0) / 100)}</div>
            </div>
          </div>
        </>
      )}

      {ch ? (
        <div className="card mt16" style={{ background: '#fafbf8' }}>
          <div className="row">
            <strong>我的选择：{HAIL_OPTION_LABEL[ch.option]}</strong>
            {ch.status === 'confirmed'
              ? <Tag cls="green">✓ 已确认，证书与到货时间已更新</Tag>
              : <Tag cls="amber">待农场确认</Tag>}
          </div>
          <div className="small muted mt8">
            {ch.option === 'delay' && <>第二批延期至 <strong>{fmtDay(ch.eta_date)}</strong> 到货</>}
            {ch.option === 'refund' && <>按比例退款 <strong>{ch.refund_pct}%</strong>，应退 {fmtMoney(ch.refund_amount)}</>}
            {ch.option === 'switch' && (
              <>
                换为「{ch.switch_title}」，预计 {fmtDay(ch.eta_date)} 到货
                <div className="mt8">
                  客服确认：
                  {ch.service_status === 'confirmed' ? <Tag cls="green">已确认</Tag>
                    : ch.service_status === 'rejected' ? <Tag cls="red">已驳回，请重新选择</Tag>
                    : <Tag cls="amber">待客服确认</Tag>}
                </div>
                <div className="mt8">
                  配送批次：
                  {ch.batch_status === 'confirmed' ? <Tag cls="green">已重新确认</Tag>
                    : ch.service_status === 'confirmed'
                      ? <Tag cls="red">待我重新确认配送批次</Tag>
                      : <Tag cls="gray">客服确认后开放</Tag>}
                </div>
                {ch.service_note && <div className="muted mt8">客服备注：{ch.service_note}</div>}
              </>
            )}
          </div>
          <div className="row mt8">
            {ch.option === 'switch' && ch.service_status === 'rejected' && !confirmed && (
              <button className="sm" onClick={() => onOpen('hail')}>重新选择</button>
            )}
            {ch.option === 'switch' && ch.service_status === 'confirmed' && ch.batch_status !== 'confirmed' && !confirmed && (
              <button className="sm amber" onClick={() => onOpen('hail-batch')}>重新确认配送批次</button>
            )}
            {ch.status !== 'confirmed' && !confirmed && (
              <button className="sm ghost" onClick={() => onOpen('hail')}>修改我的选择</button>
            )}
          </div>
        </div>
      ) : confirmed ? (
        <div className="small muted mt8">分配方案已确认关闭。</div>
      ) : (
        <div className="row mt16">
          <button className="sm amber" onClick={() => onOpen('hail')}>立即三选一</button>
          <span className="small muted">延期 / 换品类 / 按比例退款，请在采摘排产前确认</span>
        </div>
      )}
    </div>
  )
}


function AddressModal({ adoption, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ recipient_name: adoption.recipient_name, phone: adoption.phone, address: adoption.address, reason: '' })
  const submit = async () => {
    try {
      await post(`/adoptions/${adoption.id}/address`, f)
      toast('地址已更新，客服与冷链已同步并生成工单')
      onDone(); onClose()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title={`临时改地址 · 订单 #${adoption.id}`} onClose={onClose}>
      <p className="muted small">未发出的批次可在线改址；已有批次发出后需联系客服协调。</p>
      <div className="grid grid-2">
        <div><label>收货人</label><input value={f.recipient_name} onChange={(e) => setF({ ...f, recipient_name: e.target.value })} /></div>
        <div><label>手机号</label><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      </div>
      <label>新地址</label><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <label>改址原因</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="出差/搬家/送亲友…" />
      <button className="mt16" onClick={submit}>提交申请</button>
    </Modal>
  )
}

function CallbackModal({ adoption, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ satisfaction: 5, quality_score: 5, delivery_score: 5, would_renew: true, comment: '', renew_suggestion: '' })
  const stars = (k) => (
    <div>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ fontSize: 22, cursor: 'pointer', color: n <= f[k] ? '#f59e0b' : '#d1d5db' }}
              onClick={() => setF({ ...f, [k]: n })}>★</span>
      ))}
    </div>
  )
  const submit = async () => {
    try {
      await post('/callbacks', { adoption_id: adoption.id, ...f })
      toast('感谢回访，你的建议会沉淀到下一季')
      onDone(); onClose()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title={`成熟度回访 · ${adoption.title}`} onClose={onClose}>
      <label>总体满意度</label>{stars('satisfaction')}
      <label>果品/品质</label>{stars('quality_score')}
      <label>冷链配送</label>{stars('delivery_score')}
      <label><input type="checkbox" style={{ width: 'auto', marginRight: 6 }} checked={f.would_renew}
                    onChange={(e) => setF({ ...f, would_renew: e.target.checked })} />下一季愿意续认</label>
      <label>评价</label><textarea rows="2" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} />
      <label>下一季续认建议</label><textarea rows="2" value={f.renew_suggestion} onChange={(e) => setF({ ...f, renew_suggestion: e.target.value })} />
      <button className="mt16" onClick={submit}>提交回访</button>
    </Modal>
  )
}

function CertModal({ adoption, onClose }) {
  return (
    <Modal title={`认养证书${(adoption.cert_version || 1) > 1 ? ` · 第 ${adoption.cert_version} 版` : ''}`} onClose={onClose}>
      <div className="cert">
        <div className="small muted">谷香家庭农场 · 农产品认养证书</div>
        <h2 className="mt8">{adoption.recipient_name}</h2>
        <div>认养 <strong>{adoption.title}</strong></div>
        <div className="small muted">批次 {adoption.batch_no} · {adoption.shares} {adoption.unit_name || '份'}</div>
        <div className="mt8">证书编号</div>
        <div className="no" style={{ fontSize: 18 }}>{adoption.cert_no}</div>
        <div className="small muted mt8">签发日期 {fmtDay(adoption.created_at)}</div>
        {(adoption.cert_version || 1) > 1 && (
          <div className="card mt16" style={{ background: '#f0f9ff' }}>
            <Tag cls="blue">第 {adoption.cert_version} 版换发</Tag>
            <div className="small mt8">{adoption.cert_reissue_note}</div>
            {adoption.eta_date && <div className="small muted mt8">最新预计到货时间：{fmtDay(adoption.eta_date)}</div>}
          </div>
        )}
      </div>
    </Modal>
  )
}

// 三选一：延期 / 换品类 / 按比例退款
function HailChooseModal({ adoption, onClose, onDone }) {
  const toast = useToast()
  const al = adoption.hail_allocation
  const existing = adoption.hail_choice
  const switchList = Array.isArray(al.switch_option) ? al.switch_option : []
  const [opt, setOpt] = useState(existing?.option || 'delay')
  const [idx, setIdx] = useState(0)
  const [eta, setEta] = useState(al.delay_option?.eta_date || '')
  const [note, setNote] = useState(existing?.note || '')
  const [customPct, setCustomPct] = useState(al.refund_pct || 0)

  const submit = async () => {
    const body = { adoption_id: adoption.id, option: opt, note }
    if (opt === 'delay') {
      if (!eta) return toast('请确认延期后的预计到货日期', true)
      body.eta_date = eta
    } else if (opt === 'switch') {
      const s = switchList[idx]
      if (!s) return toast('暂无可换品类，请选择其他方式', true)
      body.switch_kind = s.kind
      body.switch_title = s.title
      body.switch_kg = s.kg_equiv
      body.eta_date = s.eta_date
    } else {
      body.refund_pct = customPct
    }
    try {
      await post(`/hail-allocations/${al.id}/choose`, body)
      toast(opt === 'switch' ? '已选择换品类，等待客服确认后重新确认配送批次' : '选择已提交')
      onDone(); onClose()
    } catch (e) { toast(e.message, true) }
  }

  return (
    <Modal title={`冰雹减产三选一 · 订单 #${adoption.id}`} onClose={onClose}>
      <p className="muted small">可采果 {fmtKg(al.pickable_kg)} / 承诺 {fmtKg(al.committed_kg)}，
        保险理赔{al.insurance_status === 'settled' ? '已到账' : '处理中'}。请选择补偿方式：</p>

      <label className="mt8"><input type="radio" style={{ width: 'auto', marginRight: 6 }}
        checked={opt === 'delay'} onChange={() => setOpt('delay')} />
        <strong>① 延期交付</strong>　<span className="small muted">{HAIL_OPTION_DESC.delay}</span></label>
      {opt === 'delay' && (
        <div className="grid grid-2 mt8">
          <div><label>新预计到货日期</label>
            <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
          <div><label>加送</label><input value={`精品果 ${al.delay_option?.bonus_kg || 0}kg`} disabled /></div>
        </div>
      )}

      <label className="mt16"><input type="radio" style={{ width: 'auto', marginRight: 6 }}
        checked={opt === 'switch'} onChange={() => setOpt('switch')} disabled={switchList.length === 0} />
        <strong>② 换品类</strong>　<span className="small muted">{HAIL_OPTION_DESC.switch}</span></label>
      {opt === 'switch' && (
        <div className="mt8">
          <select value={idx} onChange={(e) => setIdx(Number(e.target.value))}>
            {switchList.map((s, i) => (
              <option key={i} value={i}>{s.title}（预计 {s.eta_date} 到货）</option>
            ))}
          </select>
          <p className="small muted mt8">提交后客服将确认换品类结果，确认通过后需要你重新确认配送批次。</p>
        </div>
      )}

      <label className="mt16"><input type="radio" style={{ width: 'auto', marginRight: 6 }}
        checked={opt === 'refund'} onChange={() => setOpt('refund')} />
        <strong>③ 按比例退款</strong>　<span className="small muted">{HAIL_OPTION_DESC.refund}</span></label>
      {opt === 'refund' && (
        <div className="grid grid-2 mt8">
          <div><label>退款比例 %</label>
            <input type="number" value={customPct} onChange={(e) => setCustomPct(Number(e.target.value))} /></div>
          <div><label>预计退款</label>
            <input value={fmtMoney((adoption.amount || 0) * customPct / 100)} disabled /></div>
        </div>
      )}

      <label className="mt16">备注（可选）</label>
      <input value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="mt16" onClick={submit}>提交我的选择</button>
    </Modal>
  )
}

// 换品类：认养人重新确认配送批次
function HailBatchModal({ adoption, onClose, onDone }) {
  const toast = useToast()
  const al = adoption.hail_allocation
  const ch = adoption.hail_choice
  const [f, setF] = useState({
    seq: (ch.batch_plan?.seq) || 1,
    plan_date: ch.batch_plan?.plan_date || ch.eta_date?.slice(0, 10) || '',
    pack_spec: ch.batch_plan?.pack_spec || `【换品类】${ch.switch_title || ''}`,
    cold_route: ch.batch_plan?.cold_route || '',
    weight_kg: ch.batch_plan?.weight_kg || ch.switch_kg || 0,
  })
  const submit = async () => {
    if (!f.plan_date || !f.cold_route) return toast('请填写计划日期与冷链路线', true)
    try {
      await post(`/hail-choices/${ch.id}/batch`, { batch_plan: f })
      toast('配送批次已重新确认，等待农场统一确认分配')
      onDone(); onClose()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title={`重新确认换品类配送批次 · 订单 #${adoption.id}`} onClose={onClose}>
      <p className="muted small">客服已确认换为「{ch.switch_title}」。请确认新的配送批次，确认后预计到货时间与认养证书将更新。</p>
      <div className="grid grid-2">
        <div><label>第几批</label><input type="number" value={f.seq} onChange={(e) => setF({ ...f, seq: Number(e.target.value) })} /></div>
        <div><label>计划发货日期</label><input type="date" value={f.plan_date} onChange={(e) => setF({ ...f, plan_date: e.target.value })} /></div>
      </div>
      <label>包装规格</label><input value={f.pack_spec} onChange={(e) => setF({ ...f, pack_spec: e.target.value })} />
      <label>冷链路线</label><input value={f.cold_route} onChange={(e) => setF({ ...f, cold_route: e.target.value })} placeholder="烟台-上海虹桥（生鲜冷链整车）" />
      <label>重量 kg</label><input type="number" step="0.1" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: Number(e.target.value) })} />
      <button className="mt16" onClick={submit}>确认配送批次</button>
    </Modal>
  )
}

