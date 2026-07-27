import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Tile, Empty, Callout, Badge } from '../ui'
import { fetchFundingRounds, latestRoundValuation, roundValuation } from '../../lib/dart/funding'
import { searchCompanies } from '../../lib/dart/api'
import { loadFunding, saveFunding } from '../../lib/storage'
import { hasProxy } from '../../lib/proxyBase.js'
import { abbrev, full, dateTimeText } from '../../lib/format'

/**
 * 자본조달 이력.
 *
 * 감사보고서에는 투자 이력이 없다. 상장사는 유상증자·CB 발행을 DART 에 공시하므로
 * 그걸 모아 라운드로 만들고, 발행가로 그 시점의 기업가치를 되짚는다.
 * 비상장사는 투자 공시 의무가 없어 조회되지 않는다.
 */
export default function FundingTab({ report }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const companyKey = report?.companyKey || null
  const companyName = report?.meta?.company || null

  useEffect(() => {
    if (!companyKey) return
    let alive = true
    setLoading(true)
    setError(null)

    const pull = async (force) => {
      const cached = force ? null : await loadFunding(companyKey)
      if (cached && !cached.stale) return { payload: cached }

      // 보고서에는 DART 고유번호가 없다. 회사명으로 기업 색인에서 찾는다.
      // 이름이 정확히 같은 것만 받아들인다 — 부분일치를 쓰면 남의 회사를 물어 온다.
      setPhase('DART 고유번호 확인 중')
      const hits = await searchCompanies(companyName, 40)
      const norm = (x) => String(x || '').replace(/\s+/g, '')
      const hit = hits.find((h) => norm(h.name) === norm(companyName))
      if (!hit) {
        if (cached) return { payload: cached }
        throw new Error(`DART 에서 "${companyName}" 와 이름이 정확히 같은 회사를 찾지 못했습니다.`)
      }
      const corpCode = hit.code

      try {
        const fresh = await fetchFundingRounds(corpCode, (m) => alive && setPhase(m))
        await saveFunding(companyKey, fresh)
        return { payload: { ...fresh, fetchedAt: Date.now() } }
      } catch (e) {
        if (cached) return { payload: cached, warning: e.message }
        throw e
      }
    }

    pull(reloadKey > 0)
      .then(({ payload, warning }) => {
        if (!alive) return
        setData(payload)
        if (warning) setError(warning)
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => {
        if (!alive) return
        setLoading(false)
        setPhase('')
      })
    return () => {
      alive = false
    }
  }, [companyKey, companyName, reloadKey])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  const rounds = data?.rounds || []
  const valuation = useMemo(() => latestRoundValuation(rounds), [rounds])
  const totalRaised = useMemo(
    () => rounds.reduce((a, r) => a + (r.totalRaised || 0), 0),
    [rounds]
  )

  if (loading) {
    return (
      <Card>
        <Empty title="DART 에서 자본조달 공시를 읽는 중입니다…">{phase}</Empty>
      </Card>
    )
  }

  if (error && !rounds.length) {
    return (
      <Card title="자본조달">
        <Callout tone="warn">
          {error}
          {!hasProxy && <><br />배포본에는 조회용 프록시 주소가 설정되지 않았습니다.</>}
        </Callout>
      </Card>
    )
  }

  if (!rounds.length) {
    return (
      <Card title="자본조달">
        <Empty title="자본조달 공시가 없습니다">
          비상장 법인은 투자 유치를 공시할 의무가 없어 DART 에 나타나지 않습니다.
          감사보고서 주석의 상환전환우선주·자본금 변동으로만 짐작할 수 있습니다.
        </Empty>
      </Card>
    )
  }

  const freshness = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge tone="muted">DART</Badge>
      <span className="chip">{data?.fetchedAt ? `${dateTimeText(data.fetchedAt)} 기준` : '갱신 시각 미확인'}</span>
      <button className="btn btn-sm btn-ghost" type="button" onClick={refresh}>다시 받기</button>
    </div>
  )

  return (
    <div className="stack-lg">
      <Card
        title="자본조달 요약"
        sub={`공시 ${data.total}건 · 해석 ${data.parsed}건 → 조달 ${rounds.length}건`}
        right={freshness}
      >
        <div className="stack">
          {error && <Callout tone="warn">새로 받아오지 못해 저장된 값을 보여줍니다. ({error})</Callout>}

          <div className="grid grid-tiles">
            <Tile label="누적 조달" value={totalRaised || null} unit={totalRaised ? `${full(totalRaised)}원` : undefined} />
            <Tile label="조달 건수" value={rounds.length} unit="건" />
            {valuation && (
              <>
                <Tile
                  label="추정 기업가치 (Post)"
                  value={valuation.postMoney}
                  unit={`${valuation.rceptDt?.slice(0, 4)}년 · 발행가 ${full(valuation.issuePrice)}원`}
                  hint={full(valuation.postMoney)}
                />
                {valuation.preMoney != null && (
                  <Tile label="Pre-money" value={valuation.preMoney} unit={full(valuation.preMoney)} />
                )}
              </>
            )}
          </div>

          {valuation && (
            <Callout>
              <strong>추정 기업가치</strong>는 가장 최근 증자의 <strong>발행가 × 증자 후 발행주식총수</strong>입니다
              ({full(valuation.issuePrice)}원 × {full(valuation.sharesAfter)}주).
              {valuation.discount != null && valuation.basePrice != null && (
                <>
                  {' '}이 건은 기준주가 {full(valuation.basePrice)}원에 <strong>{Math.abs(valuation.discount)}% 할인</strong>이
                  적용된 제3자배정이라 시가보다 낮게 잡힙니다.
                </>
              )}
              {' '}전환사채·신주인수권부사채는 전환 전이라 주식수에 반영하지 않았습니다.
            </Callout>
          )}
        </div>
      </Card>

      <Card title="조달 이력" sub={`${rounds.length}건 · 최근순`} tight>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>접수일</th>
                <th>종류</th>
                <th className="num">조달금액</th>
                <th className="num">발행가</th>
                <th className="num">주식수</th>
                <th>납입일</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r) => {
                const v = roundValuation(r)
                return (
                  <tr key={r.rceptNo}>
                    <td>{fmtDate(r.rceptDt)}</td>
                    <td><Badge tone={/증자/.test(r.kind) ? 'info' : 'muted'}>{r.kind}</Badge></td>
                    <td className="num">{r.totalRaised != null ? abbrev(r.totalRaised) : '-'}</td>
                    <td className="num">{r.issuePrice != null ? full(r.issuePrice) : '-'}</td>
                    <td className="num">{r.newShares != null ? full(r.newShares) : '-'}</td>
                    <td>{r.payDate || '-'}</td>
                    <td className="txt" style={{ color: 'var(--text-3)' }}>
                      {r.mergedFrom > 1 && `공시 ${r.mergedFrom}건 합침 · `}
                      {r.isAmendment && '정정 '}
                      {v ? `기업가치 ${abbrev(v.postMoney)}` : r.maturityDate ? `만기 ${r.maturityDate}` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {data.truncated && (
        <Callout tone="warn">
          공시가 많아 최근 것부터 일부만 읽었습니다. 더 오래된 조달 이력은 목록에 없을 수 있습니다.
        </Callout>
      )}
    </div>
  )
}

function fmtDate(d) {
  const s = String(d || '')
  return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s
}
