import { useMemo, useState } from 'react'
import { Badge, Empty, Card } from './ui'
import { MiniTrend } from './charts'
import { buildTimeline, splitByPeriodType } from '../lib/analyze/series'
import { dateTimeText, abbrev, signedPct } from '../lib/format'
import { growth } from '../lib/analyze/ratios'

export function normalizeCompany(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/주식회사|\(주\)|㈜/g, '')
    .toLowerCase()
}

/** 보고서 목록을 회사 단위로 묶는다. */
export function groupByCompany(reports) {
  const map = new Map()
  for (const r of reports) {
    const key = normalizeCompany(r.meta?.company) || r.id
    if (!map.has(key)) map.set(key, { key, name: r.meta?.company || r.id, reports: [] })
    const g = map.get(key)
    g.reports.push(r)
    // 이름 표기는 가장 최근 업로드본을 따른다.
    if ((r.createdAt || 0) >= Math.max(...g.reports.map((x) => x.createdAt || 0))) g.name = r.meta?.company || g.name
  }

  return [...map.values()]
    .map((g) => {
      const sorted = [...g.reports].sort(
        (a, b) => (b.meta?.fiscalYear || 0) - (a.meta?.fiscalYear || 0) || (b.createdAt || 0) - (a.createdAt || 0)
      )
      const latest = sorted[0]
      // 회사 단위 추이는 보고기간 종류가 같은 것끼리만 만든다(연간 우선).
      const groups = splitByPeriodType(sorted)
      const primary = groups[0]
      const timeline = buildTimeline(primary ? primary.reports : [])
      const trend = timeline.rows
        .map((row) => ({ label: row.label, value: row.revenue ?? null }))
        .filter((p) => p.value != null)
      const first = trend[0]
      const last = trend[trend.length - 1]

      return {
        ...g,
        reports: sorted,
        latest,
        periodGroups: groups,
        periodLabel: primary?.label || '연간',
        mixedPeriods: groups.length > 1,
        trend,
        trendGrowth: trend.length > 1 ? growth(last.value, first.value) : null,
        trendLatest: last?.value ?? null,
        trendSpan: trend.length > 1 ? `${first.label}→${last.label}` : null,
        years: [...new Set(sorted.map((r) => r.meta?.fiscalYear).filter(Boolean))].sort((a, b) => a - b),
        auditor: latest?.meta?.auditor || null,
        opinion: latest?.opinion || null,
        basis: latest?.meta?.basis || null,
        uploadedAt: Math.max(...sorted.map((r) => r.createdAt || 0)),
        onlyLocal: sorted.every((r) => r.storage !== 'firestore'),
      }
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
}

export default function CompanyList({ companies, activeKey, onSelect }) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return companies
    return companies.filter((c) => `${c.name} ${c.auditor || ''} ${c.years.join(' ')}`.toLowerCase().includes(term))
  }, [companies, q])

  if (!companies.length) {
    return (
      <Card>
        <Empty title="저장된 감사보고서가 없습니다">감사보고서를 업로드하면 여기에 회사별로 쌓입니다.</Empty>
      </Card>
    )
  }

  return (
    <Card
      title="업로드된 회사"
      sub={`${companies.length}개 회사 · 보고서 ${companies.reduce((a, c) => a + c.reports.length, 0)}건`}
      right={
        companies.length > 6 ? (
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="회사·감사인 검색"
            aria-label="회사 검색"
            style={{
              padding: '7px 11px', fontSize: 13, fontFamily: 'inherit', minWidth: 160,
              borderRadius: 8, border: '1px solid var(--border-strong)',
              background: 'var(--surface-1)', color: 'var(--text-1)',
            }}
          />
        ) : null
      }
      tight
    >
      <ul className="colist">
        {filtered.map((c) => (
          <li key={c.key}>
            <button
              type="button"
              className={`corow${c.key === activeKey ? ' active' : ''}`}
              onClick={() => onSelect(c)}
              aria-current={c.key === activeKey ? 'true' : undefined}
            >
              <span className="co-main">
                <span className="co-name">{c.name}</span>
                <span className="co-meta">
                  <span>{c.years.length ? `${c.years.join(' · ')}년` : '연도 미확인'}</span>
                  <span aria-hidden="true">·</span>
                  <span>보고서 {c.reports.length}건</span>
                  {c.periodLabel !== '연간' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{c.periodLabel}</span>
                    </>
                  )}
                  {c.auditor && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{c.auditor}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{dateTimeText(c.uploadedAt)}</span>
                </span>
              </span>
              {c.trend.length > 1 ? (
                <span className="co-trend">
                  <MiniTrend points={c.trend} label="매출액" />
                  <span className="co-trend-txt">
                    <span className="co-trend-v">{abbrev(c.trendLatest)}</span>
                    <span className={c.trendGrowth >= 0 ? 'up' : 'down'}>{signedPct(c.trendGrowth)}</span>
                    <span className="co-trend-span">{c.trendSpan} 매출</span>
                  </span>
                </span>
              ) : (
                <span className="co-trend co-trend-empty">추이 1개 연도</span>
              )}

              <span className="co-tags">
                {c.opinion && <Badge tone={c.opinion.tone} dot>{c.opinion.label}</Badge>}
                {c.basis && <Badge tone="muted">{c.basis}</Badge>}
                {c.onlyLocal && <Badge tone="warn">브라우저에만 저장</Badge>}
              </span>
              <span className="co-go" aria-hidden="true">›</span>
            </button>
          </li>
        ))}
        {!filtered.length && (
          <li>
            <div className="card-body"><Empty title="검색 결과가 없습니다" /></div>
          </li>
        )}
      </ul>
    </Card>
  )
}
