import React, { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  get, post, INCIDENT_LABEL, INCIDENT_COLOR, ROLE_LABEL,
  fmtMoney, fmtDate, fmtDay, fmtKg, INSURANCE_STATUS_LABEL, HAIL_OPTION_LABEL,
} from '../api'
import { Tag, Modal, Empty, useToast } from '../components/ui'
import { useAuth } from '../auth'
import HailAllocSection from '../components/HailAllocSection'

const STATUS = { open: '待处理', processing: '处理中', resolved: '已解决', compensated: '已赔付' }
const STATUS_CLS = { open: 'red', processing: 'amber', resolved: 'gray', compensated: 'green' }
const COMP_LABEL = { cash: '现金赔付', reship: '补发', insurance: '保险赔付', credit: '下季抵扣' }
const ROLE_COLOR = {
  farmer: '#2f7d32', adopter: '#0369a1', picker: '#b45309',
  packer: '#7c3aed', logistics: '#be185d', service: '#0f766e', admin: '#374151',
}

export default function Incidents() {
  const [list, setList] = useState([])
  const [detail, setDetail] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [sp] = useSearchParams()
  const load = useCallback(() => get('/incidents').then(setList), [])
  useEffect(() => {
    load()
    const f = sp.get('focus')
    if (f) get(`/incidents/${f}`).then(setDetail).catch(() => {})
  }, [])

  return (
    <>
      <div className="row">
        <h1 style={{ margin: 0 }}>🧾 异常工单 · 同一认养批次协同处理</h1>
        <span className="spacer" />
        <button onClick={() => setShowNew(true)}>+ 提交工单</button>
      </div>
      <p className="muted">冰雹减产、成熟延后、临时改地址、果品不均、坏果投诉、分批争议、权益与产量不一致——农场、认养人、采摘工、包装员、物流、客服的处理结果全部串联在同一批次。</p>

      <div className="grid grid-2">
        {list.map((i) => (
          <div key={i.id} className="card" style={{ cursor: 'pointer' }} onClick={() => get(`/incidents/${i.id}`).then(setDetail)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="tag" style={{ background: '#fef2f2', color: INCIDENT_COLOR[i.kind], borderColor: '#fecaca' }}>
                {INCIDENT_LABEL[i.kind]}
              </span>
              <Tag cls={STATUS_CLS[i.status]}>{STATUS[i.status]}</Tag>
            </div>
            <h3 className="mt8">{i.title}</h3>
            <div className="small muted">{i.description}</div>
            <div className="small muted mt8">{i.project_title} · {i.batch_no} · {i.reporter_name} · {fmtDate(i.created_at)}</div>
          </div>
        ))}
        {list.length === 0 && <Empty />}
      </div>

      {detail && <IncidentDetail d={detail} onClose={() => setDetail(null)} onChanged={() => { get(`/incidents/${detail.incident.id}`).then(setDetail); load() }} />}
      {showNew && <NewIncident onClose={() => setShowNew(false)} onDone={() => { setShowNew(false); load() }} />}
    </>
  )
}

function IncidentDetail({ d, onClose, onChanged }) {
  const { user } = useAuth()
  const toast = useToast()
  const inc = d.incident
  const [act, setAct] = useState('')
  const [note, setNote] = useState('')
  const [showComp, setShowComp] = useState(false)
  const canService = user && ['service', 'admin', 'farmer'].includes(user.role)

  const addEvent = async (status) => {
    if (!act) return toast('请填写处理动作', true)
    try {
      await post(`/incidents/${inc.id}/events`, { action: act, note, ...(status ? { status } : {}) })
      setAct(''); setNote(''); toast('已记录'); onChanged()
    } catch (e) { toast(e.message, true) }
  }

  return (
    <Modal title={`工单 #${inc.id} · ${inc.title}`} onClose={onClose} wide>
      <div className="row">
        <span className="tag" style={{ background: '#fef2f2', color: INCIDENT_COLOR[inc.kind], borderColor: '#fecaca' }}>
          {INCIDENT_LABEL[inc.kind]}
        </span>
        <Tag cls={STATUS_CLS[inc.status]}>{STATUS[inc.status]}</Tag>
        <span className="small muted">{inc.project_title} · {inc.batch_no}</span>
      </div>
      <p className="mt8">{inc.description}</p>

      <div className="section-title mt16">处理流水（按时间串联各角色）</div>
      <div className="timeline">
        {d.events.map((e) => (
          <div key={e.id} className="tl-item">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{e.action}</strong>
              <Tag cls="gray">
                <span style={{ color: ROLE_COLOR[e.actor_role] }}>●</span> {e.actor_name || ROLE_LABEL[e.actor_role]}（{ROLE_LABEL[e.actor_role]}）
              </Tag>
            </div>
            {e.note && <div className="small">{e.note}</div>}
            <div className="tl-time">{fmtDate(e.created_at)}</div>
          </div>
        ))}
      </div>

      {d.compensations?.length > 0 && (
        <>
          <div className="section-title mt16">赔付记录</div>
          <table>
            <thead><tr><th>方式</th><th>金额</th><th>说明</th><th>状态</th><th>时间</th></tr></thead>
            <tbody>
              {d.compensations.map((c) => (
                <tr key={c.id}><td><Tag cls="teal">{COMP_LABEL[c.kind]}</Tag></td><td>{fmtMoney(c.amount)}</td>
                  <td className="small">{c.note}</td><td>{c.status === 'paid' ? '已到账' : '待发放'}</td><td className="small">{fmtDate(c.paid_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <HailAllocSection detail={d} onChanged={onChanged} />

      <div className="card mt16" style={{ background: '#fafbf8' }}>
        <h3>追加处理结果（当前身份：{ROLE_LABEL[user.role]}）</h3>
        <label>处理动作</label>
        <input value={act} onChange={(e) => setAct(e.target.value)}
               placeholder="如：核实情况 / 补发 / 更新冷链路线 / 包装整改 / 回访确认" />
        <label>说明</label>
        <textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="row mt8">
          <button className="sm" onClick={() => addEvent('')}>仅记录</button>
          <button className="sm ghost" onClick={() => addEvent('processing')}>标记处理中</button>
          <button className="sm ghost" onClick={() => addEvent('resolved')}>标记已解决</button>
          {canService && inc.status !== 'compensated' && (
            <button className="sm amber" onClick={() => setShowComp(true)}>登记赔付并结案</button>
          )}
        </div>
      </div>

      {showComp && <CompModal incidentId={inc.id} onClose={() => setShowComp(false)} onDone={() => { setShowComp(false); onChanged() }} />}
    </Modal>
  )
}

function CompModal({ incidentId, onClose, onDone }) {
  const toast = useToast()
  const [f, setF] = useState({ amount: 0, kind: 'cash', note: '' })
  const submit = async () => {
    if (f.amount <= 0) return toast('请填写赔付金额', true)
    try {
      await post(`/compensations/incident/${incidentId}`, f)
      toast('赔付已登记，工单自动转为已赔付'); onDone()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title="登记赔付" onClose={onClose}>
      <label>赔付方式</label>
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        <option value="cash">现金赔付</option>
        <option value="reship">补发果品</option>
        <option value="insurance">保险理赔款发放</option>
        <option value="credit">下一季认养抵扣</option>
      </select>
      <label>金额/折值 ¥</label>
      <input type="number" onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} />
      <label>说明</label>
      <textarea rows="2" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      <button className="mt16" onClick={submit}>确认赔付</button>
    </Modal>
  )
}

function NewIncident({ onClose, onDone }) {
  const toast = useToast()
  const [projects, setProjects] = useState([])
  const [f, setF] = useState({ project_id: '', kind: 'bad_fruit', title: '', description: '', adoption_id: '' })
  useEffect(() => { get('/projects').then(setProjects) }, [])
  const submit = async () => {
    if (!f.project_id || !f.title) return toast('请选择项目并填写标题', true)
    try {
      await post('/incidents', {
        ...f,
        project_id: Number(f.project_id),
        adoption_id: f.adoption_id ? Number(f.adoption_id) : undefined,
      })
      toast('工单已提交'); onDone()
    } catch (e) { toast(e.message, true) }
  }
  return (
    <Modal title="提交异常工单" onClose={onClose}>
      <label>认养项目 / 批次</label>
      <select value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
        <option value="">请选择</option>
        {projects.map((p) => <option key={p.id} value={p.id}>{p.title}（{p.batch_no}）</option>)}
      </select>
      <label>问题类型</label>
      <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
        {Object.entries(INCIDENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label>关联认养订单 ID（批次级问题可不填）</label>
      <input value={f.adoption_id} onChange={(e) => setF({ ...f, adoption_id: e.target.value })} />
      <label>标题</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label>详细描述</label><textarea rows="3" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <button className="mt16" onClick={submit}>提交</button>
    </Modal>
  )
}
