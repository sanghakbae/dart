import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Tile, Empty, Callout, Badge } from '../ui'
import { proxyUrl, hasProxy } from '../../lib/proxyBase.js'
import { loadPatents, savePatents } from '../../lib/storage'
import { dateTimeText } from '../../lib/format'

/**
 * 특허·실용신안. 감사보고서에는 무형자산 금액만 있고 건수·내용이 없어 KIPRIS 에서 따로 받는다.
 *
 * 출원인명으로 찾기 때문에 회사명이 정확해야 한다. KIPRIS 는 "주식회사 무하유" 처럼
 * 법인격을 붙여 등록돼 있어, 두 표기를 모두 시도한다.
 */
export default function PatentTab({ report }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const companyKey = report?.companyKey || null
  const company = report?.meta?.company || null

  useEffect(() => {
    if (!company) return
    let alive = true
    setLoading(true)
    setError(null)

    const pull = async (force) => {
      const cached = force ? null : await loadPatents(companyKey)
      if (cached && !cached.stale) return { payload: cached }
      try {
        const fresh = await fetchPatents(company)
        await savePatents(companyKey, fresh)
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
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [company, companyKey, reloadKey])

  const patents = data?.patents || []

  const stats = useMemo(() => {
    const registered = patents.filter((p) => p.registrationNumber).length
    const byYear = new Map()
    for (const p of patents) {
      const y = Number(String(p.applicationDate || '').slice(0, 4))
      if (Number.isFinite(y)) byYear.set(y, (byYear.get(y) || 0) + 1)
    }
    const years = [...byYear.entries()].sort((a, b) => b[0] - a[0])
    return { registered, pending: patents.length - registered, years }
  }, [patents])

  if (loading) return <Card><Empty title="KIPRIS 에서 특허를 불러오는 중입니다…" /></Card>

  if (error && !patents.length) {
    return (
      <Card title="특허·실용신안">
        <Callout tone="warn">
          {error}
          {!hasProxy && <><br />배포본에는 조회용 프록시 주소가 설정되지 않았습니다.</>}
        </Callout>
      </Card>
    )
  }

  if (!patents.length) {
    return (
      <Card title="특허·실용신안">
        <Empty title={`${company} 명의의 특허를 찾지 못했습니다`}>
          출원인명이 정확히 일치해야 조회됩니다. 법인격 표기(주식회사 …)가 다르거나
          출원인이 개인·관계사 명의일 수 있습니다.
        </Empty>
      </Card>
    )
  }

  const freshness = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge tone="muted">KIPRIS</Badge>
      <span className="chip">{data?.fetchedAt ? `${dateTimeText(data.fetchedAt)} 기준` : '갱신 시각 미확인'}</span>
      <button className="btn btn-sm btn-ghost" type="button" onClick={() => setReloadKey((k) => k + 1)}>
        다시 받기
      </button>
    </div>
  )

  return (
    <div className="stack-lg">
      <Card title="특허 현황" sub={`출원인 ${data.applicant}`} right={freshness}>
        <div className="stack">
          {error && <Callout tone="warn">새로 받아오지 못해 저장된 값을 보여줍니다. ({error})</Callout>}
          <div className="grid grid-tiles">
            <Tile label="전체" value={data.total} suffix="건" />
            <Tile label="등록" value={stats.registered} suffix="건" tone="good" />
            <Tile label="출원·공개" value={stats.pending} suffix="건" />
            {stats.years[0] && <Tile label={`${stats.years[0][0]}년 출원`} value={stats.years[0][1]} suffix="건" />}
          </div>
          {data.truncated && (
            <Callout tone="warn">
              KIPRIS 출원인 검색은 이름이 비슷한 남의 특허까지 함께 돌려줍니다
              (검색 결과 {data.upstreamHits?.toLocaleString('ko-KR')}건 중 {data.scanned}건까지 확인).
              출원인명이 정확히 같은 건만 세었지만, 더 뒤쪽에 남은 건이 있을 수 있습니다.
            </Callout>
          )}
        </div>
      </Card>

      {stats.years.length > 1 && (
        <Card title="연도별 출원" sub={`${stats.years.length}개 연도`} tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr><th>연도</th><th className="num">출원 건수</th></tr>
              </thead>
              <tbody>
                {stats.years.map(([y, n]) => (
                  <tr key={y}><td>{y}년</td><td className="num">{n}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="특허 목록" sub={`${patents.length}건 · 출원일 최근순`} tight>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>출원일</th>
                <th>상태</th>
                <th>발명의 명칭</th>
                <th>출원번호</th>
                <th>등록번호</th>
                <th>IPC</th>
              </tr>
            </thead>
            <tbody>
              {patents.map((p) => (
                <tr key={p.applicationNumber}>
                  <td>{p.applicationDate || '-'}</td>
                  <td><Badge tone={p.registrationNumber ? 'good' : 'muted'}>{p.status || '-'}</Badge></td>
                  <td className="txt" title={p.abstract} style={{ whiteSpace: 'normal', maxWidth: '32em' }}>
                    {p.title}
                  </td>
                  <td>{p.applicationNumber}</td>
                  <td>{p.registrationNumber || '-'}</td>
                  <td className="txt" style={{ color: 'var(--text-3)' }}>{p.ipc.slice(0, 2).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/**
 * 이름 변형(주식회사 유무)과 정확 일치 판정은 프록시가 한다.
 * 출원인 검색이 토큰 검색이라 "알체라" 로 부르면 2.3만 건이 걸리는데,
 * 그 걸러내기를 화면에서 하면 매번 상류를 여러 번 두드려야 한다.
 */
async function fetchPatents(company) {
  const res = await fetch(proxyUrl(`/api/kipris/patents?applicant=${encodeURIComponent(company)}`))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}
