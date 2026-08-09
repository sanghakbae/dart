import { useMemo, useState } from 'react'
import { Card, Empty, Callout, Badge } from './ui'
import { abbrev, full, signedPct, pctText } from '../lib/format'

/**
 * 회사 비교.
 *
 * DB 에 회사가 계속 쌓이는데 나란히 볼 데가 없었다. 투자든 채용이든 실제 질문은
 * "이 회사가 저 회사보다 나은가" 라서, 쌓인 값을 재배치해 한 표에 놓는다.
 *
 * 새로 계산하는 값은 없다 — 목록에 이미 실려 오는 compare 지표를 그대로 쓴다.
 * 대신 기준(연결/별도)과 연도가 회사마다 다를 수 있어 그것을 숨기지 않고 같이 적는다.
 */

const METRICS = [
  { key: 'revenue', label: '매출액', kind: 'won', good: 'high' },
  { key: 'revenueGrowth', label: '매출 증가율', kind: 'pct', good: 'high' },
  { key: 'operatingProfit', label: '영업이익', kind: 'won', good: 'high' },
  { key: 'opMargin', label: '영업이익률', kind: 'pct', good: 'high' },
  { key: 'netIncome', label: '당기순이익', kind: 'won', good: 'high' },
  { key: 'netMargin', label: '순이익률', kind: 'pct', good: 'high' },
  { key: 'roe', label: 'ROE', kind: 'pct', good: 'high' },
  { key: 'totalAssets', label: '자산총계', kind: 'won', good: 'high' },
  { key: 'totalEquity', label: '자본총계', kind: 'won', good: 'high' },
  { key: 'debtRatio', label: '부채비율', kind: 'pct', good: 'low' },
  { key: 'equityRatio', label: '자기자본비율', kind: 'pct', good: 'high' },
  { key: 'cash', label: '현금및현금성자산', kind: 'won', good: 'high' },
  { key: 'cfOperating', label: '영업활동현금흐름', kind: 'won', good: 'high' },
]

const MAX = 4

export default function ComparePage({ companies, onBack, onSelect }) {
  const pickable = useMemo(() => companies.filter((c) => c.compare), [companies])
  const [keys, setKeys] = useState(() => pickable.slice(0, 2).map((c) => c.key))

  const picked = useMemo(
    () => keys.map((k) => pickable.find((c) => c.key === k)).filter(Boolean),
    [keys, pickable]
  )

  const toggle = (key) =>
    setKeys((ks) =>
      ks.includes(key) ? ks.filter((k) => k !== key) : ks.length >= MAX ? ks : [...ks, key]
    )

  // 어느 회사가 가장 나은지 칸에 표시한다. 값이 하나뿐이면 비교가 아니므로 표시하지 않는다.
  const bestOf = (m) => {
    const vals = picked.map((c) => c.compare?.[m.key]).filter((v) => typeof v === 'number')
    if (vals.length < 2) return null
    return m.good === 'low' ? Math.min(...vals) : Math.max(...vals)
  }

  const fmt = (v, kind) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '-'
    if (kind === 'pct') return pctText(v)
    return `${abbrev(v)}원`
  }

  // 회사마다 기준·연도가 다르면 그 자체가 비교의 함정이라 먼저 알린다.
  const mixedYear = new Set(picked.map((c) => c.compare.year)).size > 1
  const mixedBasis = new Set(picked.map((c) => c.compare.basis)).size > 1
  const impaired = picked.filter((c) => c.compare.capitalImpaired)

  return (
    <div className="stack-lg">
      <div className="co-head">
        <button className="btn btn-back" type="button" onClick={onBack}>‹ 회사 목록</button>
        <strong>회사 비교</strong>
        <span className="co-head-meta">최대 {MAX}개까지 나란히 볼 수 있습니다</span>
      </div>

      <Card title="비교할 회사" sub={`${picked.length}개 선택 · 전체 ${pickable.length}개`}>
        {!pickable.length ? (
          <Empty title="비교할 회사가 없습니다">감사보고서를 올리면 여기에 쌓입니다.</Empty>
        ) : (
          <div className="cmp-pick">
            {pickable.map((c) => {
              const on = keys.includes(c.key)
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`btn btn-sm${on ? ' btn-primary' : ''}`}
                  onClick={() => toggle(c.key)}
                  disabled={!on && keys.length >= MAX}
                  aria-pressed={on}
                >
                  {c.name}
                  <span className="cmp-yr">{c.compare.year}</span>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {picked.length < 2 ? (
        <Card><Empty title="두 개 이상 골라 주세요">회사를 두 개 이상 선택하면 표가 나타납니다.</Empty></Card>
      ) : (
        <>
          {(mixedYear || mixedBasis) && (
            <Callout tone="warn">
              {mixedYear && <>회사마다 <strong>사업연도가 다릅니다</strong>. </>}
              {mixedBasis && <>연결과 별도가 <strong>섞여 있습니다</strong> — 연결은 종속회사까지 합산한 수치라 규모가 커 보입니다. </>}
              아래 표의 굵은 값은 그대로 우열로 읽지 마시고, 각 열의 연도·기준을 함께 보세요.
            </Callout>
          )}

          {impaired.length > 0 && (
            <Callout tone="warn">
              <strong>{impaired.map((c) => c.name).join(' · ')}</strong> 는 자본총계가 0 이하입니다(자본잠식).
              자본을 분모로 쓰는 <strong>ROE·부채비율은 비우고</strong> 표시했습니다 — 순손실을 음수 자본으로
              나누면 부호가 뒤집혀 흑자 회사보다 좋아 보입니다.
            </Callout>
          )}

          <Card title="지표 비교" sub="각 회사의 가장 최근 사업연도 기준" tight>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl cmp">
                <thead>
                  <tr>
                    <th>지표</th>
                    {picked.map((c) => (
                      <th key={c.key} className="num">
                        <button type="button" className="cmp-name" onClick={() => onSelect?.(c)}>
                          {c.name}
                        </button>
                        <span className="cmp-sub">
                          {c.compare.year}년 · {c.compare.basis}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m) => {
                    const best = bestOf(m)
                    return (
                      <tr key={m.key}>
                        <td>{m.label}</td>
                        {picked.map((c) => {
                          const v = c.compare?.[m.key]
                          const isBest = best != null && v === best
                          return (
                            <td
                              key={c.key}
                              className={`num${isBest ? ' cmp-best' : ''}`}
                              title={typeof v === 'number' && m.kind === 'won' ? `${full(v)}원` : undefined}
                            >
                              {m.kind === 'pct' && typeof v === 'number' && m.key.endsWith('Growth')
                                ? signedPct(v)
                                : fmt(v, m.kind)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="누적 현황" tight>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>회사</th>
                    <th className="num">쌓인 연도</th>
                    <th className="num">보고서</th>
                    <th>감사의견</th>
                    <th>감사인</th>
                  </tr>
                </thead>
                <tbody>
                  {picked.map((c) => (
                    <tr key={c.key}>
                      <td>{c.name}</td>
                      <td className="num">{c.compare.years}개년</td>
                      <td className="num">{c.reportCount}건</td>
                      <td>{c.opinion ? <Badge tone={c.opinion.tone} dot>{c.opinion.label}</Badge> : '-'}</td>
                      <td style={{ color: 'var(--text-2)' }}>{c.auditor || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
