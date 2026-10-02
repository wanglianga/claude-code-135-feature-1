import React, { useEffect, useState } from 'react'
import { get, post, HAIL_OPTION_LABEL, HAIL_OPTION_EMOJI, INSURANCE_STATUS_LABEL, KIND_EMOJI, fmtKg, fmtMoney, fmtDay } from '../api'
import { Tag, Modal, Empty, useToast } from '../components/ui'

const OPT_CLS = { delay: 'blue', swap: 'purple', refund: 'amber' }

export default function HailPanel({ adoption, onDone }) {
  const toast = useToast()
  const h = adoption.hail_allocation
  const [show, setShow] = useState(false)
  if (!h) return null
  const published = h.allocation_status === 'published' || h.allocation_status === 'closed'
  const pending = published && h.status === 'pending'
  const insLabel = INSURANCE_STATUS_LABEL[h.insurance_status] || h.insurance_status

  return (
    <div className="card mt16" style={{ background: 'linear-gradient(120deg,#fff7ed,#fffbeb)', borderColor: '#fed7aa' }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>🧊 冰雹减产分配</h3>
        <Tag cls={h.status === 'confirmed' ? 'green' : 'red'}>{h.status === 'confirmed' ? '已确认选择' : '待选择'}</Tag>
        <span className="spacer" />
        {h.insurance_status && (
          <Tag cls={h.insurance_status === 'settled' ? 'green' : 'amber'}>
            🛡 保险理赔：{insLabel}{h.insurance_amount ? ` ${fmtMoney(h.insurance_amount)}` : ''}
          </Tag>
        )}
      </div>
      <div className="grid grid-4 mt16">
        <div className="stat"><div className="n">{fmtKg(h.promised_kg)}</div><div className="l">认养承诺产量</div></div>
        <div className="stat amber"><div className="n">{fmtKg(h.pickable_kg)}</div><div className="l">可采果数量</div></div>
        <div className="stat red"><div className="n">{fmtKg(h.shortage_kg)}</div><div className="l">保底缺口</div></div>
        <div className="stat blue"><div className="n">{h.new_eta_date ? fmtDay(h.new_eta_date) : '—'}</div><div className="l">延期后预计到货</div></div>
      </div>
      <div className="small muted mt8">理赔状态已同步认养人；{h.policy_no ? `保单 ${h.policy_no}。` : ''}农场续认信用随分配结果同步变化。</div>

      {pending && (
        <div className="mt16">
          <div className="small muted">冰雹导致产量低于认养承诺，请在三个补偿方案中选择其一：</div>
          <div className="grid grid-3 mt8">
            <button onClick={() => setShow('delay')}>🗓 延期交付<br /><span className="small muted">顺延到货，权益不变</span></button>
            <button onClick={() => setShow('swap')}>🔁 换品类<br /><span className="small muted">等值换购其他品类</span></button>
            <button onClick={() => setShow('refund')}>💸 按比例退款<br /><span className="small muted">按保底缺口原路退回</span></button>
          </div>
        </div>
      )}

      {h.status === 'confirmed' && (
        <div className="mt16">
          <div className="row">
            <Tag cls={OPT_CLS[h.option]}>{HAIL_OPTION_EMOJI[h.option]} 已选择：{HAIL_OPTION_LABEL[h.option]}</Tag>
            {h.eta_date && <Tag cls="blue">预计到货 {fmtDay(h.eta_date)}</Tag>}
            {h.batch_eta_date && <Tag cls="blue">换购批次到货 {fmtDay(h.batch_eta_date)}</Tag>}
          </div>
          <ConfirmedDetail h={h} onDone={onDone} />
        </div>
      )}

      {show && (
        <ChoiceModal
          option={show}
          adoption={adoption}
          onClose={() => setShow(false)}
          onDone={() => { setShow(false); onDone() }}
        />
      )}
    </div>
  )
}

function ConfirmedDetail({ h, onDone }) {
  const toast = useToast()
  const [showBatch, setShowBatch] = useState(false)
  if (h.option === 'delay') {
    return <div className="small mt8">{h.plan_delay}<br /><span className="muted">未发批次已顺延，认养证书已换发。</span></div>
  }
  if (h.option === 'refund') {
    return (
      <div className="small mt8">
        按保底缺口比例 <strong>{h.refund_pct}%</strong> 原路退款 <strong>{fmtMoney(h.refund_amount)}</strong>，认养证书已换发留存。
      </div>
    )
  }
  // swap
  return (
    <div className="small mt8">
      {KIND_EMOJI[h.swap_kind]} 换购：<strong>{h.swap_project_title}</strong>（{h.swap_batch_no}），
      等值兑换 <strong>{h.swap_shares}</strong> 份。
      {h.service_status === 'pending' && (
        <div className="mt8"><Tag cls="amber">⏳ 换品类待客服确认</Tag><span className="muted">客服确认后需重新确认配送批次。</span></div>
      )}
      {h.service_status === 'rejected' && (
        <div className="mt8"><Tag cls="red">换品类被客服驳回</Tag><span className="muted">{h.service_note || '请联系客服重新选择方案'}</span></div>
      )}
      {h.service_status === 'confirmed' && h.batch_status === 'pending' && (
        <div className="mt8">
          <Tag cls="blue">客服已确认换品类，结果已同步客服</Tag>
          <div className="mt8">
            拟配送批次：第 {h.batch_seq} 批 · {fmtDay(h.batch_plan_date)} 发货 · {fmtDay(h.batch_eta_date)} 到货
            {h.batch_spec ? ` · ${h.batch_spec}` : ''}
          </div>
          <button className="sm mt8" onClick={() => setShowBatch(true)}>✅ 重新确认配送批次</button>
        </div>
      )}
      {h.service_status === 'confirmed' && h.batch_status === 'confirmed' && (
        <div className="mt8">
          <Tag cls="green">配送批次已重新确认</Tag>
          <span className="muted">第 {h.batch_seq} 批 · {fmtDay(h.batch_plan_date)} 发货 · {fmtDay(h.batch_eta_date)} 到货，认养证书已换发。</span>
        </div>
      )}
      {showBatch && <BatchModal h={h} onClose={() => setShowBatch(false)} onDone={() => { setShowBatch(false); onDone() }} />}
    </div>
  )
}

function ChoiceModal({ option, adoption, onClose, onDone }) {
  const toast = useToast()
  const h = adoption.hail_allocation
  const [projects, setProjects] = useState([])
  const [f, setF] = useState({
    swap_project_id: '', eta_date: h.new_eta_date ? String(h.new_eta_date).slice(0, 10) : '',
    note: '',
  })
  useEffect(() => { if (option === 'swap') get('/projects').then(setProjects) }, [option])

  const submit = async () => {
    try {
      if (option === 'delay' && !f.eta_date) return toast('请确认延期后的预计到货日期', true)
      if (option === 'swap' && !f.swap_project_id) return toast('请选择换购品类', true)
      const body = { adoption_id: adoption.id, option, note: f.note }
      if (option === 'delay') body.eta_date = f.eta_date
      if (option === 'swap') body.swap_project_id = Number(f.swap_project_id)
      await post(`/hail-allocations/${h.allocation_id}/choices`, body)
      toast(option === 'swap' ? '换品类申请已提交，等待客服确认' : '选择已确认，认养证书将换发')
      onDone()
    } catch (e) { toast(e.message, true) }
  }

  const planText = { delay: h.plan_delay, swap: h.plan_swap, refund: h.plan_refund }[option]

  return (
    <Modal title={`冰雹减产 · 选择${HAIL_OPTION_LABEL[option]}`} onClose={onClose}>
      <div className="small" style={{ background: '#f8fafc', padding: 10, borderRadius: 8 }}>{planText || '—'}</div>
      {option === 'delay' && (
        <>
          <label className="mt8">延期后预计到货日期</label>
          <input type="date" value={f.eta_date} onChange={(e) => setF({ ...f, eta_date: e.target.value })} />
          <p className="small muted">确认后未发批次计划与预计到货时间更新，认养证书换发，保底权益不变。</p>
        </>
      )}
      {option === 'swap' && (
        <>
          <label className="mt8">换购品类（本农场其他在养项目，按已付金额等值兑换）</label>
          <select value={f.swap_project_id} onChange={(e) => setF({ ...f, swap_project_id: e.target.value })}>
            <option value="">请选择</option>
            {projects
              .filter((p) => p.farm_id === adoption.farm_id && p.id !== adoption.project_id)
              .map((p) => <option key={p.id} value={p.id}>{KIND_EMOJI[p.kind]} {p.title}（{p.batch_no}）· {fmtMoney(p.price_per_share)}/{p.unit_name}</option>)}
          </select>
          <p className="small muted">提交后由客服确认换品类，确认后你还需要重新确认配送批次，随后认养证书换发。</p>
        </>
      )}
      {option === 'refund' && (
        <p className="small mt8">按保底缺口比例 <strong>{h.promised_kg > 0 ? ((h.shortage_kg / h.promised_kg) * 100).toFixed(2) : 0}%</strong> 原路退回，
          预计退款 <strong>{fmtMoney(h.promised_kg > 0 ? adoption.amount * h.shortage_kg / h.promised_kg : 0)}</strong>，认养证书换发留存。</p>
      )}
      <label className="mt8">备注（可选）</label>
      <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button className="mt16" onClick={submit}>确认选择</button>
    </Modal>
  )
}

function BatchModal({ h, onClose, onDone }) {
  const toast = useToast()
  const day = (v) => (v ? String(v).slice(0, 10) : '')
  const [f, setF] = useState({
    batch_seq: h.batch_seq || 1,
    batch_plan_date: day(h.batch_plan_date),
    batch_eta_date: day(h.batch_eta_date),
    batch_spec: h.batch_spec || '',
  })
  const submit = async () => {
    if (!f.batch_plan_date || !f.batch_eta_date) return toast('请确认发货与到货日期', true)
    try {
      await post(`/hail-choices/${h.id}/batch`, f)
      toast('换购配送批次已确认，认养证书已换发')
      onDone()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title="重新确认换品类配送批次" onClose={onClose}>
      <p className="small muted">客服已确认换品类（结果已同步客服）。请确认换购批次的发货/到货时间，确认后认养证书与预计到货时间更新。</p>
      <div className="grid grid-2">
        <div><label>批次序号</label><input type="number" value={f.batch_seq} onChange={(e) => setF({ ...f, batch_seq: Number(e.target.value) })} /></div>
        <div><label>包装规格</label><input value={f.batch_spec} onChange={(e) => setF({ ...f, batch_spec: e.target.value })} /></div>
        <div><label>发货日期</label><input type="date" value={f.batch_plan_date} onChange={(e) => setF({ ...f, batch_plan_date: e.target.value })} /></div>
        <div><label>预计到货</label><input type="date" value={f.batch_eta_date} onChange={(e) => setF({ ...f, batch_eta_date: e.target.value })} /></div>
      </div>
      <button className="mt16" onClick={submit}>确认配送批次</button>
    </Modal>
  )
}
