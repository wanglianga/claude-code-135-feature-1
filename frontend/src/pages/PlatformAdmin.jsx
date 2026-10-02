import React, { useEffect, useState } from 'react'
import { get, fmtMoney, KIND_LABEL, KIND_EMOJI, fmtDate, fmtDay, HAIL_ALLOC_STATUS, HAIL_OPTION_LABEL } from '../api'
import { Stat, Tag, Empty } from '../components/ui'

export default function PlatformAdmin() {
  const [d, setD] = useState(null)
  useEffect(() => { get('/admin/overview').then(setD).catch(() => {}) }, [])
  if (!d) return <Empty text="加载中…（仅平台管理员可查看）" />
  const s = d.stats
  return (
    <>
      <h1>📊 平台运营总览 · 认养季数据沉淀</h1>
      <div className="grid grid-4">
        <Stat label="入驻农场" value={s.farms} />
        <Stat label="认养项目" value={s.projects} />
        <Stat label="认养订单" value={s.adoptions} cls="blue" />
        <Stat label="注册用户" value={s.users} />
        <Stat label="总销售额" value={fmtMoney(s.total_sales)} cls="amber" />
        <Stat label="累计赔付" value={fmtMoney(s.total_compensation)} cls="red" />
        <Stat label="保险理赔到账" value={fmtMoney(s.insurance_settled)} />
        <Stat label="待处理工单" value={s.open_incidents} cls="red" />
        <Stat label="公益代捐份额" value={s.charity_shares} />
        <Stat label="企业团购需求" value={s.group_buy_count} cls="blue" />
        <Stat label="冰雹减产分配" value={s.hail_allocations} cls="red" />
        <Stat label="待办换品类确认" value={s.hail_pending_choices} cls="amber" />
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <div className="section-title">🧊 冰雹减产分配跟踪</div>
          {(d.hail_allocations || []).length === 0 ? <Empty text="暂无减产分配方案" /> : (
            <table>
              <thead><tr><th>方案</th><th>可采/承诺</th><th>退款比例</th><th>状态</th><th>确认时间</th></tr></thead>
              <tbody>
                {(d.hail_allocations || []).map((h) => (
                  <tr key={h.id}>
                    <td className="small">{h.title}<br /><span className="muted">{h.project_title} · {h.batch_no}</span></td>
                    <td className="small">{Number(h.pickable_kg || 0).toFixed(0)} / {Number(h.committed_kg || 0).toFixed(0)} kg</td>
                    <td>{h.refund_pct}%</td>
                    <td><Tag cls={h.status === 'confirmed' ? 'green' : 'amber'}>{HAIL_ALLOC_STATUS[h.status] || h.status}</Tag></td>
                    <td className="small muted">{h.confirmed_at ? fmtDate(h.confirmed_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="section-title">⭐ 农场续认信用榜</div>
          {(d.renew_credits || []).length === 0 ? <Empty text="暂无信用记录" /> : (
            <table>
              <thead><tr><th>农场</th><th>季节</th><th>信用分</th><th>等级</th><th>延期/换品类/退款</th></tr></thead>
              <tbody>
                {(d.renew_credits || []).map((c) => (
                  <tr key={c.id}>
                    <td className="small">{c.farm_name}</td>
                    <td>{c.season}</td>
                    <td><strong>{Number(c.score).toFixed(0)}</strong></td>
                    <td><Tag cls={c.level === 'A' ? 'green' : c.level === 'B' ? 'amber' : 'red'}>{c.level}</Tag></td>
                    <td className="small">{c.delayed_shares} / {c.switched_shares} / {c.refunded_shares}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <div className="section-title">🍎🫐🍯🌾🥬 各品类认养情况</div>
          <table>
            <thead><tr><th>品类</th><th>项目数</th><th>已售份额</th></tr></thead>
            <tbody>
              {d.projects_by_kind.map((k) => (
                <tr key={k.kind}><td>{KIND_EMOJI[k.kind]} {KIND_LABEL[k.kind]}</td><td>{k.n}</td><td>{k.sold}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="section-title">📜 最近结季项目（地块成本与满意度沉淀）</div>
          <table>
            <thead><tr><th>批次/项目</th><th>产量</th><th>成本</th><th>赔付</th><th>满意度</th><th>续认率</th></tr></thead>
            <tbody>
              {d.recent_settlements.map((st) => (
                <tr key={st.id}>
                  <td className="small">{st.title}<br /><span className="muted">{st.batch_no} · {fmtDate(st.created_at)}</span></td>
                  <td>{st.total_yield_kg}kg</td><td>{fmtMoney(st.total_cost)}</td>
                  <td style={{ color: st.total_compensation > 0 ? 'var(--red)' : undefined }}>{fmtMoney(st.total_compensation)}</td>
                  <td>{st.avg_satisfaction ?? '—'}</td><td>{st.renew_rate_pct ?? '—'}%</td>
                </tr>
              ))}
              {d.recent_settlements.length === 0 && <tr><td colSpan="6"><Empty text="暂无结季数据" /></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-title">🔁 数据如何反哺下一季</div>
        <div className="grid grid-3">
          <div><Tag cls="green">地块成本</Tag><p className="small muted mt8">按地块沉淀农事投入、防灾、采摘、分拣、物流、赔付六类成本，指导下一季定价与份额设计。</p></div>
          <div><Tag cls="amber">客户满意度</Tag><p className="small muted mt8">回访评分与续认意愿形成续认率，识别高价值认养人与高风险品类。</p></div>
          <div><Tag cls="blue">续认建议</Tag><p className="small muted mt8">认养人的续认建议（如免套袋有机果、亲子采摘日）直接进入下一季项目策划。</p></div>
        </div>
      </div>
    </>
  )
}
