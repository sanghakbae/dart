import { useMemo, useState } from 'react'
import { Badge, Empty, Card } from './ui'
import { MiniTrend } from './charts'
import { growth } from '../lib/analyze/ratios'
import { dateTimeText, abbrev, signedPct } from '../lib/format'

/**
 * 회사 리스트. 항목은 회사 누적 문서(companies/{key})에서 만든 뷰다.
 * 업로드할 때마다 그 회사 문서에 연도 기준으로 누적되므로 여기서는 결과만 보여준다.
 */
export default function CompanyList({ companies, activeKey, onSelect, onDelete, deletingKey }) {
  const [q, setQ] = useState('')

  const rows = useMemo(
    () =>
      companies.map((c) => {
        const first = c.trend[0]
        const last = c.trend[c.trend.length - 1]
        return {
          ...c,
          trendGrowth: c.trend.length > 1 ? growth(last.value, first.value) : null,
          trendLatest: last?.value ?? null,
          trendSpan: c.trend.length > 1 ? `${first.label}→${last.label}` : null,
        }
      }),
    [companies]
  )

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((c) => `${c.name} ${c.auditor || ''} ${c.years.join(' ')}`.toLowerCase().includes(term))
  }, [rows, q])

  if (!companies.length) {
    return (
      <Card>
        <Empty title="저장된 감사보고서가 없습니다">감사보고서를 업로드하면 회사별로 누적됩니다.</Empty>
      </Card>
    )
  }

  const totalReports = companies.reduce((a, c) => a + (c.reportCount || 0), 0)

  return (
    <Card
      title="업로드된 회사"
      sub={`${companies.length}개 회사 · 보고서 ${totalReports}건`}
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
          <li key={c.key} className="corow-wrap">
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
                  <span>보고서 {c.reportCount}건</span>
                  {c.periodTypes.length > 1 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>연간+분기</span>
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
                <span className="co-trend co-trend-empty">누적 연도 {c.years.length}개</span>
              )}

              <span className="co-tags">
                {c.opinion && <Badge tone={c.opinion.tone} dot>{c.opinion.label}</Badge>}
                {c.basis && <Badge tone="muted">{c.basis}</Badge>}
                {c.storage !== 'firestore' && <Badge tone="warn">브라우저에만 저장</Badge>}
              </span>
              <span className="co-go" aria-hidden="true">›</span>
            </button>
            {onDelete && (
              <button
                type="button"
                className="co-del"
                onClick={() => onDelete(c)}
                disabled={deletingKey === c.key}
                title={`${c.name} 삭제`}
                aria-label={`${c.name} 삭제`}
              >
                {deletingKey === c.key ? '삭제 중…' : '삭제'}
              </button>
            )}
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
