import React, { useEffect, useState } from 'react'
import { get, post, fmtKg, fmtMoney, fmtDay, INSURANCE_STATUS_LABEL, HAIL_OPTION_LABEL } from '../api'
import { Tag, Modal, Empty, useToast } from '../components/ui'
import { useAuth } from '../auth'

export default function HailAllocSection({ detail, onChanged }) {
  const { user } = useAuth()
  const toast = useToast()
  const inc = detail.incident
  const allocs = detail.hail_allocations || []
  const [showReg, setShowReg] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [full, setFull] = useState(null)

  useEffect(() => {
    if (detailId) get(`/hail-allocations/${detailId}`).then(setFull).catch(() => {})
  }, [detailId])

  if (inc.kind !== 'hail') return null
  const canManage = user && ['farmer', 'admin', 'service'].includes(user.role)

  return (
    <div className="section-title mt16">
      <div className="section-title">🧊 冰雹减产分配（受灾照片 · 保险报案 · 可采果 · 三选一）</div>
      {allocs.length === 0 && (
        <>
          <Empty text="尚未登记冰雹减产分配" />
          {canManage && <button className="sm" onClick={() => setShowReg(true)}>📝 登记减产分配（照片/保险/可采果/方案）</button>}
        </>
      )}
      {allocs.map((a) => {
        const done = `${a.confirmed_count}/${a.choice_count}`
        return (
          <div key={a.id} className="card mt8" style={{ background: '#fafbf8' }}>
            <div className="row">
              <Tag cls={a.status === 'closed' ? 'green' : a.status === 'published' ? 'blue' : 'amber'}>
                {a.status === 'draft' ? '草稿（未发布）' : a.status === 'published' ? '方案已发布' : '分配已关闭'}
              </Tag>
              {a.insurance_status && (
                <Tag cls={a.insurance_status === 'settled' ? 'green' : 'amber'}>
                  🛡 保险：{INSURANCE_STATUS_LABEL[a.insurance_status] || a.insurance_status}
                </Tag>
              )}
              <span className="spacer" />
              <button className="sm ghost" onClick={() => setDetailId(a.id)}>查看分配明细</button>
            </div>
            <div className="grid grid-4 mt8">
              <Mini label="受影响份额" v={`${a.affected_shares} 份`} />
              <Mini label="承诺产量" v={fmtKg(a.promised_kg)} />
              <Mini label="可采果" v={fmtKg(a.pickable_kg)} cls="amber" />
              <Mini label="保底缺口" v={fmtKg(a.shortage_kg)} cls="red" />
            </div>
            <div className="small muted mt8">
              认养人确认进度 {done} · 农场续认信用影响 <strong style={{ color: '#dc2626' }}>{a.credit_delta > 0 ? '+' : ''}{a.credit_delta}</strong>
              {a.new_eta_date ? ` · 延期后预计到货 ${fmtDay(a.new_eta_date)}` : ''}
            </div>
          </div>
        )
      })}

      {showReg && <RegModal incident={inc} onClose={() => setShowReg(false)} onDone={() => { setShowReg(false); onChanged() }} />}
      {full && (
        <AllocDetailModal
          data={full}
          onClose={() => { setFull(null); setDetailId(null) }}
          onChanged={() => { get(`/hail-allocations/${full.allocation.id}`).then(setFull); onChanged() }}
        />
      )}
    </div>
  )
}

function Mini({ label, v, cls = '' }) {
  return <div className={'stat ' + cls}><div className="n" style={{ fontSize: 18 }}>{v}</div><div className="l">{label}</div></div>
}

function RegModal({ incident, onClose, onDone }) {
  const toast = useToast()
  const [claims, setClaims] = useState([])
  const [f, setF] = useState({
    pickable_kg: '',
    insurance_claim_id: '',
    plan_delay: '本季认养继续有效：未发批次顺延发货并更新预计到货时间，保底缺口由保险理赔款按比例折算补偿。',
    plan_swap: '可等值换购本农场其他品类，客服确认后重新编排配送批次并换发认养证书。',
    plan_refund: '按保底缺口比例原路退回认养款，认养证书换发留存。',
    new_eta_date: '',
  })
  useEffect(() => {
    get(`/insurance-claims`).then((all) =>
      setClaims(all.filter((c) => c.project_id === incident.project_id))
    ).catch(() => {})
  }, [incident.project_id])
  const submit = async () => {
    if (!f.pickable_kg) return toast('请填写可采果数量', true)
    try {
      await post(`/hail-allocations`, {
        incident_id: incident.id,
        pickable_kg: Number(f.pickable_kg),
        insurance_claim_id: f.insurance_claim_id ? Number(f.insurance_claim_id) : undefined,
        plan_delay: f.plan_delay, plan_swap: f.plan_swap, plan_refund: f.plan_refund,
        new_eta_date: f.new_eta_date || undefined,
      })
      toast('减产分配已登记（受灾照片取自灾害日志）')
      onDone()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title="登记冰雹减产分配" onClose={onClose} wide>
      <p className="small muted">受灾照片自动关联本批次的冰雹灾害日志；保险报案可选择已登记的理赔单。系统按 承诺产量=已售份额×保底量 自动计算缺口。</p>
      <div className="grid grid-2">
        <div><label>可采果数量 kg</label><input type="number" value={f.pickable_kg} onChange={(e) => setF({ ...f, pickable_kg: e.target.value })} /></div>
        <div>
          <label>关联保险报案</label>
          <select value={f.insurance_claim_id} onChange={(e) => setF({ ...f, insurance_claim_id: e.target.value })}>
            <option value="">不关联 / 稍后处理</option>
            {claims.map((c) => <option key={c.id} value={c.id}>{c.policy_no} · {INSURANCE_STATUS_LABEL[c.status] || c.status}</option>)}
          </select>
        </div>
        <div style={{ gridColumn: '1/-1' }}><label>延期方案 · 新预计到货</label>
          <div className="grid grid-2">
            <input value={f.new_eta_date} type="date" onChange={(e) => setF({ ...f, new_eta_date: e.target.value })} />
          </div>
        </div>
      </div>
      <label>① 延期方案说明</label><textarea rows="2" value={f.plan_delay} onChange={(e) => setF({ ...f, plan_delay: e.target.value })} />
      <label>② 换品类方案说明</label><textarea rows="2" value={f.plan_swap} onChange={(e) => setF({ ...f, plan_swap: e.target.value })} />
      <label>③ 按比例退款方案说明</label><textarea rows="2" value={f.plan_refund} onChange={(e) => setF({ ...f, plan_refund: e.target.value })} />
      <button className="mt16" onClick={submit}>登记分配方案</button>
    </Modal>
  )
}

function AllocDetailModal({ data, onClose, onChanged }) {
  const { user } = useAuth()
  const toast = useToast()
  const a = data.allocation
  const choices = data.choices || []
  const canManage = ['farmer', 'admin', 'service'].includes(user.role)
  const isService = ['service', 'admin'].includes(user.role)
  const [svc, setSvc] = useState(null)
  const [busy, setBusy] = useState(false)

  const publish = async () => {
    try { await post(`/hail-allocations/${a.id}/publish`, {}); toast('三选一方案已推送给全部认养人'); onChanged() }
    catch (e) { toast(e.message, true) }
  }
  const close = async () => {
    try {
      const r = await post(`/hail-allocations/${a.id}/close`, {})
      toast(`分配已关闭，农场续认信用更新为 ${r.renew_credit}`)
      onChanged()
    } catch (e) { toast(e.message, true) }
  }

  return (
    <Modal title={`冰雹减产分配 #${a.id}`} onClose={onClose} wide>
      <div className="row">
        <Tag cls={a.status === 'closed' ? 'green' : a.status === 'published' ? 'blue' : 'amber'}>
          {a.status === 'draft' ? '草稿' : a.status === 'published' ? '已发布' : '已关闭'}
        </Tag>
        <span className="small muted">{a.project_title} · {a.batch_no}</span>
        <span className="spacer" />
        {a.status === 'draft' && canManage && <button className="sm" onClick={publish}>📢 发布三选一</button>}
        {a.status === 'published' && canManage && <button className="sm amber" onClick={close}>✅ 全部确认后关闭并同步信用</button>}
      </div>

      <div className="grid grid-4 mt16">
        <Mini label="受影响份额" v={`${a.affected_shares}`} />
        <Mini label="承诺产量" v={fmtKg(a.promised_kg)} />
        <Mini label="可采果" v={fmtKg(a.pickable_kg)} cls="amber" />
        <Mini label="缺口" v={fmtKg(a.shortage_kg)} cls="red" />
      </div>
      {a.disaster_photos && (
        <div className="small mt8">📷 受灾照片：{a.disaster_photos.map ? a.disaster_photos.map((p) => p.caption).join('、') : ''}</div>
      )}

      <div className="section-title mt16">认养人选择</div>
      <table>
        <thead><tr><th>认养人/订单</th><th>选择</th><th>明细</th><th>客服</th><th>批次</th><th>状态</th>{isService && <th>操作</th>}</tr></thead>
        <tbody>
          {choices.map((c) => (
            <tr key={c.id}>
              <td className="small">{c.user_name}<br /><span className="muted">#{c.adoption_id} · {c.recipient_name}</span></td>
              <td><Tag cls={c.option === 'refund' ? 'amber' : c.option === 'swap' ? 'purple' : 'blue'}>{HAIL_OPTION_LABEL[c.option]}</Tag></td>
              <td className="small">
                {c.option === 'refund' && `${c.refund_pct}% · ${fmtMoney(c.refund_amount)}`}
                {c.option === 'delay' && `到货 ${fmtDay(c.eta_date || a.new_eta_date)}`}
                {c.option === 'swap' && `${c.swap_project_title || ''} ×${c.swap_shares}`}
              </td>
              <td>{c.option === 'swap'
                ? <Tag cls={c.service_status === 'confirmed' ? 'green' : c.service_status === 'rejected' ? 'red' : 'amber'}>
                    {c.service_status === 'confirmed' ? '已确认换品类' : c.service_status === 'rejected' ? '已驳回' : '待客服确认'}
                  </Tag>
                : '—'}</td>
              <td className="small">{c.option === 'swap'
                ? `第${c.batch_seq || 1}批 ${fmtDay(c.batch_plan_date)}→${fmtDay(c.batch_eta_date)} · ${c.batch_status === 'confirmed' ? '已重新确认' : '待认养人确认'}`
                : '—'}</td>
              <td><Tag cls={c.status === 'confirmed' ? 'green' : 'red'}>{c.status === 'confirmed' ? '已确认' : '待选择'}</Tag></td>
              {isService && (
                <td>
                  {c.option === 'swap' && c.service_status !== 'confirmed' && (
                    <button className="sm ghost" onClick={() => setSvc(c)}>客服确认</button>
                  )}
                </td>
              )}
            </tr>
          ))}
          {choices.length === 0 && <tr><td colSpan="7"><Empty text="尚未发布，无认养人选择" /></td></tr>}
        </tbody>
      </table>

      {svc && <ServiceSwapModal choice={svc} onClose={() => setSvc(null)} onDone={() => { setSvc(null); onChanged() }} />}
    </Modal>
  )
}

function ServiceSwapModal({ choice, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({
    batch_seq: choice.batch_seq || 1,
    batch_plan_date: fmtDay(choice.batch_plan_date) || '',
    batch_eta_date: fmtDay(choice.batch_eta_date) || '',
    batch_spec: choice.batch_spec || '',
    note: '换品类等值兑换已确认，结果同步客服与冷链，待认养人重新确认配送批次。',
  })
  const confirm = async (reject) => {
    try {
      await post(`/hail-choices/${choice.id}/service`, {
        action: reject ? 'reject' : 'confirm',
        ...(reject ? {} : f),
        note: f.note,
      })
      toast(reject ? '已驳回换品类' : '客服已确认换品类，结果已同步客服')
      onDone()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title={`客服确认换品类 · ${choice.user_name}`} onClose={onClose}>
      <p className="small muted">认养人申请换购 <strong>{choice.swap_project_title}</strong> ×{choice.swap_shares} 份。请确认/修订换购配送批次安排。</p>
      <div className="grid grid-2">
        <div><label>批次序号</label><input type="number" value={f.batch_seq} onChange={(e) => setF({ ...f, batch_seq: Number(e.target.value) })} /></div>
        <div><label>包装规格</label><input value={f.batch_spec} onChange={(e) => setF({ ...f, batch_spec: e.target.value })} /></div>
        <div><label>发货日期</label><input type="date" value={f.batch_plan_date} onChange={(e) => setF({ ...f, batch_plan_date: e.target.value })} /></div>
        <div><label>预计到货</label><input type="date" value={f.batch_eta_date} onChange={(e) => setF({ ...f, batch_eta_date: e.target.value })} /></div>
      </div>
      <label>客服备注（同步认养人）</label><textarea rows="2" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <div className="row mt16">
        <button onClick={() => confirm(false)}>确认换品类并同步</button>
        <span className="spacer" />
        <button className="ghost" onClick={() => confirm(true)}>驳回</button>
      </div>
    </Modal>
  )
}
