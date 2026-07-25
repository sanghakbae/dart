import { useState, useId } from 'react'
import {
  ResponsiveContainer, ComposedChart, BarChart, LineChart, PieChart,
  Bar, Line, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList,
} from 'recharts'
import { abbrev, full, pctText, signedPct, ratioText } from '../lib/format'
import { Seg, FinTable, Empty } from './ui'

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)']
const GRID = 'var(--grid)'
const AXIS = 'var(--axis)'
const INK3 = 'var(--text-3)'
const SURFACE = 'var(--surface-1)'

const axisX = { stroke: AXIS, tickLine: false, tick: { fill: INK3, fontSize: 11 }, dy: 4 }
const axisY = { stroke: AXIS, tickLine: false, axisLine: false, tick: { fill: INK3, fontSize: 11 }, width: 56 }

/** 차트와 표를 같은 카드 안에서 토글한다 — 색만으로 값을 읽게 두지 않기 위한 필수 장치. */
export function ChartCard({ title, sub, note, legend, height = 260, children, table, extra }) {
  const [view, setView] = useState('chart')
  const id = useId()
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
        <div className="spacer" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {extra}
          {table && (
            <Seg
              ariaLabel={`${title} 보기 방식`}
              value={view}
              onChange={setView}
              options={[{ value: 'chart', label: '차트' }, { value: 'table', label: '표' }]}
            />
          )}
        </div>
      </header>
      <div className={`card-body${view === 'table' ? ' tight' : ''}`}>
        {view === 'chart' ? (
          <div className="chart-box">
            {legend && <Legend items={legend} />}
            <ResponsiveContainer width="100%" height={height} id={id}>
              {children}
            </ResponsiveContainer>
            {note && <div className="chart-note">{note}</div>}
          </div>
        ) : (
          table
        )}
      </div>
    </section>
  )
}

export function Legend({ items }) {
  if (!items?.length) return null
  return (
    <div className="chart-legend">
      {items.map((i) => (
        <span className="li" key={i.label}>
          <i className="sw" style={{ background: i.color, ...(i.line ? { height: 3, borderRadius: 2 } : null) }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

function TipBox({ title, rows }) {
  return (
    <div className="viz-tooltip">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div className="tt-row" key={r.name}>
          <span className="nm">
            {r.color && <i className="sw" style={{ background: r.color }} />}
            {r.name}
          </span>
          <span className="vl">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

const amountTip = (unitLabel) => ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <TipBox
      title={label}
      rows={payload
        .filter((p) => p.value != null && p.dataKey !== '__base')
        .map((p) => ({ name: p.name, color: p.color || p.fill, value: `${full(p.value)}${unitLabel || '원'}` }))}
    />
  )
}

const pctTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <TipBox
      title={label}
      rows={payload.filter((p) => p.value != null).map((p) => ({ name: p.name, color: p.color || p.fill, value: signedPct(p.value) }))}
    />
  )
}

// ── 금액 추이 (연도별 막대) ────────────────────────────────────
export function AmountTrend({ data, series, title, sub, note, height = 280 }) {
  const usable = series.filter((s) => data.some((d) => d[s.key] != null))
  if (!usable.length || data.length < 1) {
    return <div className="card"><div className="card-body"><Empty title={`${title} — 표시할 데이터가 없습니다`}>해당 계정과목을 인식하지 못했습니다.</Empty></div></div>
  }
  const legend = usable.map((s, i) => ({ label: s.label, color: s.color || SERIES[i] }))
  return (
    <ChartCard
      title={title}
      sub={sub}
      note={note}
      legend={legend}
      height={height}
      table={
        <FinTable
          columns={data.map((d) => ({ key: String(d.year), label: d.label }))}
          rows={usable.map((s) => ({
            label: s.label,
            level: 0,
            values: Object.fromEntries(data.map((d) => [String(d.year), d[s.key]])),
          }))}
        />
      }
    >
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="22%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axisX} />
        <YAxis {...axisY} tickFormatter={(v) => abbrev(v, 0)} />
        <Tooltip content={amountTip()} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
        <ReferenceLine y={0} stroke={AXIS} />
        {usable.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color || SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={46} />
        ))}
      </ComposedChart>
    </ChartCard>
  )
}

// ── 전년 대비 증감률 (다이버징 막대) ──────────────────────────
export function GrowthBars({ rows, title, sub, note, height = 300 }) {
  const data = rows.filter((r) => r.value != null)
  if (!data.length) {
    return <div className="card"><div className="card-body"><Empty title="증감률을 계산할 수 없습니다">전기 비교치를 인식하지 못했습니다.</Empty></div></div>
  }
  return (
    <ChartCard
      title={title}
      sub={sub}
      note={note}
      legend={[{ label: '증가', color: 'var(--div-pos)' }, { label: '감소', color: 'var(--div-neg)' }]}
      height={Math.max(height, data.length * 38 + 40)}
      table={
        <FinTable
          columns={[
            { key: 'prior', label: '전기' },
            { key: 'current', label: '당기' },
            { key: 'g', label: '증감률', render: (v) => signedPct(v) },
          ]}
          rows={data.map((r) => ({ label: r.label, level: 0, values: { prior: r.prior, current: r.current, g: r.value } }))}
        />
      }
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 46, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" {...axisX} tickFormatter={(v) => `${v}%`} />
        <YAxis type="category" dataKey="label" {...axisY} width={104} />
        <Tooltip content={pctTip} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
        <ReferenceLine x={0} stroke={AXIS} />
        <Bar dataKey="value" name="전년 대비" radius={4} maxBarSize={20}>
          {data.map((r) => (
            <Cell key={r.label} fill={r.value >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} />
          ))}
          <LabelList dataKey="value" position="right" formatter={(v) => signedPct(v)} style={{ fill: 'var(--text-2)', fontSize: 11 }} />
        </Bar>
      </BarChart>
    </ChartCard>
  )
}

// ── 재무구조: 부채 + 자본 = 자산 (누적 막대) ─────────────────
export function StructureStack({ data, title, sub, note, height = 280 }) {
  const usable = data.filter((d) => d.totalLiabilities != null || d.totalEquity != null)
  if (!usable.length) {
    return <div className="card"><div className="card-body"><Empty title="재무구조를 표시할 수 없습니다">부채·자본총계를 인식하지 못했습니다.</Empty></div></div>
  }
  return (
    <ChartCard
      title={title}
      sub={sub}
      note={note}
      legend={[{ label: '부채총계', color: SERIES[1] }, { label: '자본총계', color: SERIES[0] }]}
      height={height}
      table={
        <FinTable
          columns={usable.map((d) => ({ key: String(d.year), label: d.label }))}
          rows={[
            { label: '부채총계', level: 1, values: Object.fromEntries(usable.map((d) => [String(d.year), d.totalLiabilities])) },
            { label: '자본총계', level: 1, values: Object.fromEntries(usable.map((d) => [String(d.year), d.totalEquity])) },
            { label: '자산총계', level: 0, isSum: true, values: Object.fromEntries(usable.map((d) => [String(d.year), d.totalAssets])) },
          ]}
        />
      }
    >
      <ComposedChart data={usable} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="26%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axisX} />
        <YAxis {...axisY} tickFormatter={(v) => abbrev(v, 0)} />
        <Tooltip content={amountTip()} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
        <Bar dataKey="totalLiabilities" name="부채총계" stackId="a" fill={SERIES[1]} stroke={SURFACE} strokeWidth={2} maxBarSize={54} />
        <Bar dataKey="totalEquity" name="자본총계" stackId="a" fill={SERIES[0]} stroke={SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={54} />
      </ComposedChart>
    </ChartCard>
  )
}

// ── 손익 워터폴 ───────────────────────────────────────────────
export function ProfitWaterfall({ steps, title, sub, note, height = 300 }) {
  if (!steps.length) {
    return <div className="card"><div className="card-body"><Empty title="손익 구조를 표시할 수 없습니다">매출액·영업이익을 인식하지 못했습니다.</Empty></div></div>
  }
  let running = 0
  const data = steps.map((s) => {
    if (s.total) {
      running = s.value
      return { ...s, __base: 0, __bar: s.value, kind: 'total' }
    }
    const base = s.value >= 0 ? running : running + s.value
    const row = { ...s, __base: Math.min(base, running), __bar: Math.abs(s.value), kind: s.value >= 0 ? 'up' : 'down' }
    running += s.value
    return row
  })
  const color = (k) => (k === 'total' ? 'var(--seq-550)' : k === 'up' ? 'var(--div-pos)' : 'var(--div-neg)')

  return (
    <ChartCard
      title={title}
      sub={sub}
      note={note}
      legend={[
        { label: '합계 항목', color: 'var(--seq-550)' },
        { label: '이익 증가', color: 'var(--div-pos)' },
        { label: '이익 감소', color: 'var(--div-neg)' },
      ]}
      height={height}
      table={
        <FinTable
          columns={[{ key: 'v', label: '금액' }, { key: 'kind', label: '구분' }]}
          rows={data.map((d) => ({
            label: d.label,
            level: d.total ? 0 : 1,
            isSum: d.total,
            values: { v: d.value, kind: d.total ? '합계' : d.value >= 0 ? '증가' : '감소' },
          }))}
        />
      }
    >
      <ComposedChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axisX} interval={0} tick={{ fill: INK3, fontSize: 10.5 }} />
        <YAxis {...axisY} tickFormatter={(v) => abbrev(v, 0)} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const d = payload[0]?.payload
            if (!d) return null
            return <TipBox title={d.label} rows={[{ name: d.total ? '합계' : d.value >= 0 ? '증가' : '감소', color: color(d.kind), value: `${full(d.value)}원` }]} />
          }}
          cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }}
        />
        <ReferenceLine y={0} stroke={AXIS} />
        <Bar dataKey="__base" stackId="w" fill="transparent" isAnimationActive={false} />
        <Bar dataKey="__bar" stackId="w" radius={[4, 4, 0, 0]} maxBarSize={44}>
          {data.map((d) => (
            <Cell key={d.label} fill={color(d.kind)} />
          ))}
        </Bar>
      </ComposedChart>
    </ChartCard>
  )
}

// ── 현금흐름 3구분 ────────────────────────────────────────────
export function CashflowChart({ data, title, sub, note, height = 280 }) {
  const keys = [
    { key: 'cfOperating', label: '영업활동', color: SERIES[0] },
    { key: 'cfInvesting', label: '투자활동', color: SERIES[1] },
    { key: 'cfFinancing', label: '재무활동', color: SERIES[2] },
  ]
  const usable = keys.filter((k) => data.some((d) => d[k.key] != null))
  if (!usable.length) {
    return <div className="card"><div className="card-body"><Empty title="현금흐름을 표시할 수 없습니다">현금흐름표를 인식하지 못했습니다.</Empty></div></div>
  }
  return (
    <ChartCard
      title={title}
      sub={sub}
      note={note}
      legend={usable.map((k) => ({ label: k.label, color: k.color }))}
      height={height}
      table={
        <FinTable
          columns={data.map((d) => ({ key: String(d.year), label: d.label }))}
          rows={usable.map((k) => ({ label: `${k.label}현금흐름`, level: 0, values: Object.fromEntries(data.map((d) => [String(d.year), d[k.key]])) }))}
        />
      }
    >
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" {...axisX} />
        <YAxis {...axisY} tickFormatter={(v) => abbrev(v, 0)} />
        <Tooltip content={amountTip()} cursor={{ fill: 'var(--surface-2)', opacity: 0.6 }} />
        <ReferenceLine y={0} stroke={AXIS} />
        {usable.map((k) => (
          <Bar key={k.key} dataKey={k.key} name={k.label} fill={k.color} radius={[4, 4, 0, 0]} maxBarSize={34} />
        ))}
      </ComposedChart>
    </ChartCard>
  )
}

// ── 비율 추이: 지표마다 작은 차트 하나 (단위가 다른 지표를 한 축에 섞지 않는다) ──
export function RatioSpark({ data, ratio, height = 150 }) {
  const points = data.filter((d) => d[ratio.key] != null)
  if (points.length < 1) return null
  const last = points[points.length - 1]
  const first = points[0]
  const dir = points.length > 1 ? last[ratio.key] - first[ratio.key] : null
  const good = dir == null ? null : ratio.good === 'low' ? dir < 0 : dir > 0

  return (
    <section className="card">
      <header className="card-head" style={{ paddingBottom: 8 }}>
        <h3 style={{ fontSize: 13.5 }}>{ratio.label}</h3>
        <span className="sub" style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
          {ratioText(last[ratio.key], ratio.unit)}
          {dir != null && (
            <span className={good ? 'up' : 'down'} style={{ marginLeft: 6, fontWeight: 600 }}>
              {dir > 0 ? '▲' : dir < 0 ? '▼' : '—'}
            </span>
          )}
        </span>
      </header>
      <div className="card-body" style={{ paddingTop: 6 }}>
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={points} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" {...axisX} tick={{ fill: INK3, fontSize: 10.5 }} />
            <YAxis {...axisY} width={46} tickFormatter={(v) => (ratio.unit === '%' ? `${Math.round(v)}` : v.toFixed(1))} />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TipBox title={label} rows={[{ name: ratio.label, color: 'var(--series-1)', value: ratioText(payload[0].value, ratio.unit) }]} />
                ) : null
              }
            />
            {ratio.bench != null && <ReferenceLine y={ratio.bench} stroke={AXIS} label={{ value: `기준 ${ratio.bench}${ratio.unit}`, fill: INK3, fontSize: 10, position: 'insideTopRight' }} />}
            <Line
              type="monotone"
              dataKey={ratio.key}
              name={ratio.label}
              stroke="var(--series-1)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--series-1)', stroke: SURFACE, strokeWidth: 2 }}
              activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
        <div className="chart-note">
          단위 {ratio.unit} · 높을수록 {ratio.good === 'low' ? '부담이 큼' : '양호'}
        </div>
      </div>
    </section>
  )
}

// ── 자산 구성 ─────────────────────────────────────────────────
export function CompositionDonut({ slices, title, sub, note, height = 250 }) {
  const data = slices.filter((s) => s.value != null && s.value > 0).slice(0, 6)
  if (data.length < 2) {
    return <div className="card"><div className="card-body"><Empty title={`${title} — 표시할 데이터가 없습니다`}>세부 계정과목을 인식하지 못했습니다.</Empty></div></div>
  }
  const total = data.reduce((a, b) => a + b.value, 0)
  return (
    <ChartCard
      title={title}
      sub={sub}
      note={note}
      legend={data.map((d, i) => ({ label: d.label, color: SERIES[i % SERIES.length] }))}
      height={height}
      table={
        <FinTable
          columns={[{ key: 'v', label: '금액' }, { key: 'p', label: '비중', render: (v) => pctText(v) }]}
          rows={data.map((d) => ({ label: d.label, level: 1, values: { v: d.value, p: (d.value / total) * 100 } }))}
          note={`합계 ${full(total)}원`}
        />
      }
    >
      <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TipBox
                title={payload[0].name}
                rows={[
                  { name: '금액', color: payload[0].payload.fill, value: `${full(payload[0].value)}원` },
                  { name: '비중', value: pctText((payload[0].value / total) * 100) },
                ]}
              />
            ) : null
          }
        />
        <Pie data={data} dataKey="value" nameKey="label" innerRadius="52%" outerRadius="80%" paddingAngle={2} stroke={SURFACE} strokeWidth={2}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={SERIES[i % SERIES.length]} />
          ))}
        </Pie>
      </PieChart>
    </ChartCard>
  )
}
