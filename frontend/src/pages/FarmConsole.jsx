import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  get, post, fmtMoney, fmtKg, fmtDay, INCIDENT_LABEL, INCIDENT_COLOR, KIND_EMOJI,
} from '../api'
import { Stat, Tag, Empty, ShipFlow, useToast } from '../components/ui'

export default function FarmConsole() {
  const [d, setD] = useState(null)
  const nav = useNavigate()
  useEffect(() => { get('/farm/dashboard').then(setD).catch(() => {}) }, [])
  if (!d) return <Empty text="加载中…（仅农场账号可查看）" />
  const s = d.stats
  return (
    <>
      <h1>🚜 农场工作台 · 谷香家庭农场</h1>
      <div className="grid grid-4">
        <Stat label="在售/在养项目" value={s.project_count} />
        <Stat label="累计认养份额" value={s.sold_shares} cls="blue" />
        <Stat label="累计销售额" value={fmtMoney(s.total_sales)} cls="amber" />
        <Stat label="地块成本(2026季)" value={fmtMoney(s.total_cost)} />
        <Stat label="累计赔付支出" value={fmtMoney(s.total_compensation)} cls="red" />
        <Stat label="平均客户满意度" value={Number(s.avg_satisfaction || 0).toFixed(2) + ' / 5'} />
        <Stat label="客户续认率" value={Number(s.renew_rate || 0).toFixed(0) + '%'} cls="amber" />
        <Stat label="续认信用分" value={Number(s.renew_credit || 100).toFixed(2)} cls={s.renew_credit < 100 ? 'red' : 'green'} />
        <Stat label="待处理工单" value={d.open_incidents.length} cls="red" />
      </div>
      {s.renew_credit_note && (
        <div className="card mt16" style={{ background: '#fffbeb' }}>
          <strong>🌦 续认信用同步记录：</strong>
          <span className="small"> {s.renew_credit_note}</span>
        </div>
      )}

      <div className="grid grid-2 mt16">
        <div className="card">
          <div className="section-title">🌍 地块（点击查看完整账）</div>
          <table>
            <thead><tr><th>地块</th><th>作物</th><th>面积</th><th>项目数</th><th>本季成本</th></tr></thead>
            <tbody>
              {d.plots.map((p) => (
                <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/plots/${p.id}/ledger`)}>
                  <td><strong>{p.name}</strong><br /><span className="small muted">{p.location}</span></td>
                  <td>{KIND_EMOJI[p.crop] || '🌱'} {p.crop}</td>
                  <td>{p.area_mu} 亩</td>
                  <td>{p.project_count}</td>
                  <td>{fmtMoney(p.season_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="section-title">⚠️ 待处理工单</div>
          {d.open_incidents.length === 0 ? <Empty text="暂无待处理工单 🎉" /> : (
            <table>
              <tbody>
                {d.open_incidents.map((i) => (
                  <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => nav('/incidents?focus=' + i.id)}>
                    <td><span className="tag" style={{ background: '#fef2f2', color: INCIDENT_COLOR[i.kind], borderColor: '#fecaca' }}>
                      {INCIDENT_LABEL[i.kind]}</span></td>
                    <td className="small">{i.title}<br /><span className="muted">{i.project_title}</span></td>
                    <td><Tag cls={i.status === 'processing' ? 'amber' : 'red'}>{i.status === 'processing' ? '处理中' : '待处理'}</Tag></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-title">🌳 认养项目进度（按成熟度/发货组织采摘）</div>
        <table>
          <thead><tr><th>批次/项目</th><th>状态</th><th>认养</th><th>预计成熟</th><th>已采摘</th><th>已发货</th><th>满意度</th><th>续认率</th><th></th></tr></thead>
          <tbody>
            {d.projects.map((p) => (
              <tr key={p.id}>
                <td><strong>{p.title}</strong><br /><span className="small muted">{p.batch_no}</span></td>
                <td><Tag cls={p.status === 'completed' ? 'gray' : 'amber'}>
                  {p.status === 'ongoing' ? '认养中' : p.status === 'harvesting' ? '采摘配送中' : '已结季'}</Tag></td>
                <td>{p.sold_shares}/{p.total_shares}</td>
                <td>{fmtDay(p.est_mature_date)}</td>
                <td>{fmtKg(p.harvested_kg)}</td>
                <td>{fmtKg(p.shipped_kg)}</td>
                <td>{Number(p.avg_satisfaction || 0).toFixed(1)}</td>
                <td>{Number(p.renew_rate || 0).toFixed(0)}%</td>
                <td><button className="sm ghost" onClick={() => nav('/projects/' + p.id)}>管理</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="section-title">🚚 待办发货（按成熟度与订单优先级排产）</div>
        <table>
          <thead><tr><th>项目</th><th>批次</th><th>计划日期</th><th>收货人</th><th>冷链路线</th><th>状态</th></tr></thead>
          <tbody>
            {d.active_shipments.map((s) => (
              <tr key={s.id}>
                <td className="small">{s.title}</td><td>第{s.seq}批</td><td>{fmtDay(s.plan_date)}</td>
                <td>{s.recipient_name || '—'}</td><td className="small muted">{s.cold_route || '—'}</td>
                <td><ShipFlow status={s.status} /></td>
              </tr>
            ))}
            {d.active_shipments.length === 0 && <tr><td colSpan="6"><Empty text="暂无待办发货" /></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  )
}
