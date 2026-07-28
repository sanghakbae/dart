import { useMemo, useState } from 'react'
import { Badge, Empty, Card } from './ui'
import { dateTimeText } from '../lib/format'

/**
 * 회사 리스트. 항목은 회사 누적 문서(companies/{key})에서 만든 뷰다.
 * 업로드할 때마다 그 회사 문서에 연도 기준으로 누적되므로 여기서는 결과만 보여준다.
 */
export default function CompanyList({ companies, activeKey, onSelect, onDelete, deletingKey }) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return companies
    return companies.filter((c) =>
      `${c.name} ${c.auditor || ''} ${c.years.join(' ')}`.toLowerCase().includes(term)
    )
  }, [companies, q])

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
              {/* 회사명과 메타를 한 줄에 흘린다. 두 줄로 쌓으면 행이 두 배로 높아져
                  회사가 늘수록 목록을 훑기 어렵다. 좁아지면 자연히 접힌다. */}
              <span className="co-main">
                <span className="co-name">{c.name}</span>
                <span className="co-meta">
                  <span>보고서 {c.reportCount}건</span>
                  {(c.byBasis || []).length > 1 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span title="기준별로 쌓인 연도 수">
                        {c.byBasis.map((b) => `${b.basis} ${b.years.length}개년`).join(' / ')}
                      </span>
                    </>
                  )}
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
                  {c.shared && (
                    <>
                      <span aria-hidden="true">·</span>
                      <Badge tone="info">공통 노출</Badge>
                    </>
                  )}
                </span>
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
