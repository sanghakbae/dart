import { useCallback, useMemo } from 'react'
import { Card, Tile, Callout, Badge } from '../ui'
import { RemoteBar, RemoteEmpty } from '../RemoteBar'
import { hasProxy } from '../../lib/proxyBase.js'
import { fetchPatents } from '../../lib/externals'
import { loadPatents, savePatents } from '../../lib/storage'
import { useCachedRemote } from '../../lib/useCachedRemote'

/**
 * 특허·실용신안. 감사보고서에는 무형자산 금액만 있고 건수·내용이 없어 KIPRIS 에서 따로 받는다.
 *
 * 출원인명으로 찾기 때문에 회사명이 정확해야 한다. KIPRIS 는 "주식회사 무하유" 처럼
 * 법인격을 붙여 등록돼 있어, 두 표기를 모두 시도한다.
 */
export default function PatentTab({ report }) {
  const companyKey = report?.companyKey || null
  const company = report?.meta?.company || null

  const { data, fetchedAt, stale, loading, fetching, error, warning, fetchNow } = useCachedRemote({
    key: companyKey,
    load: loadPatents,
    save: savePatents,
    ready: Boolean(company),
    fetch: useCallback(() => fetchPatents(company), [company]),
  })

  const patents = data?.patents || []

  const stats = useMemo(() => {
    const registered = patents.filter((p) => p.registrationNumber).length
    const byYear = new Map()
    for (const p of patents) {
      const y = Number(String(p.applicationDate || '').slice(0, 4))
      if (Number.isFinite(y)) byYear.set(y, (byYear.get(y) || 0) + 1)
    }
    const years = [...byYear.entries()].sort((a, b) => b[0] - a[0])
    const max = years.reduce((m, [, n]) => Math.max(m, n), 1)
    return { registered, pending: patents.length - registered, years, max }
  }, [patents])

  if (loading) return <Card><div className="tnote">저장된 특허 정보를 확인하는 중…</div></Card>

  const bar = (
    <RemoteBar source="KIPRIS" fetchedAt={fetchedAt} stale={stale} fetching={fetching} onFetch={fetchNow} />
  )

  // 자동으로 받지 않는다. 저장된 게 없으면 버튼만 보여 준다.
  if (!patents.length) {
    return (
      <Card title="특허·실용신안" right={fetchedAt ? bar : null}>
        <RemoteEmpty
          source="KIPRIS"
          title={fetchedAt ? `${company} 명의의 특허를 찾지 못했습니다` : '아직 받아오지 않았습니다'}
          fetching={fetching}
          onFetch={fetchNow}
          error={error || (!hasProxy ? '배포본에는 조회용 프록시 주소가 설정되지 않았습니다.' : null)}
        >
          {fetchedAt
            ? '출원인명이 정확히 일치해야 조회됩니다. 법인격 표기(주식회사 …)가 다르거나 출원인이 개인·관계사 명의일 수 있습니다.'
            : 'KIPRIS 무료 한도가 월 1,000건이라 자동으로 받지 않습니다. 한 번 받아오면 DB 에 저장해 두고 씁니다.'}
        </RemoteEmpty>
      </Card>
    )
  }

  return (
    <div className="stack-lg">
      <Card title="특허 현황" sub={`출원인 ${data.applicant}`} right={bar}>
        <div className="stack">
          {error && <Callout tone="warn">새로 받아오지 못해 저장된 값을 보여줍니다. ({error})</Callout>}
          {warning && <Callout tone="warn">받아왔지만 DB 에 저장하지 못했습니다. 화면을 다시 열면 사라집니다. ({warning})</Callout>}
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
        <Card title="연도별 출원" sub={`${stats.years[0][0]}~${stats.years[stats.years.length - 1][0]}년`}>
          {/* 표로 늘어놓으면 아홉 줄을 눈으로 훑어야 한다. 막대 하나로 흐름이 바로 보인다.
              최근 연도를 맨 위에 둔다 — 특허 목록도 최근순이라 눈이 같은 방향으로 움직인다. */}
          <ul className="yearbars">
            {stats.years.map(([y, n]) => (
              <li key={y}>
                <span className="yb-y">{y}</span>
                <span className="yb-track">
                  <i style={{ width: `${Math.max(4, (n / stats.max) * 100)}%` }} />
                </span>
                <span className="yb-n">{n}</span>
              </li>
            ))}
          </ul>
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
                  <td className="txt" style={{ whiteSpace: 'normal', maxWidth: '32em' }}>
                    <a
                      href={kiprisUrl(p.applicationNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={p.abstract}
                    >
                      {p.title}
                    </a>
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
 * KIPRIS 특허 상세. 출원번호로 바로 열린다(하이픈 없는 13자리).
 * plus.kipris 가 아니라 일반 KIPRIS 쪽이라 로그인 없이 볼 수 있다.
 */
function kiprisUrl(applicationNumber) {
  const n = String(applicationNumber || '').replace(/\D/g, '')
  return `https://www.kipris.or.kr/khome/search/searchResult.do?queryText=AN%3D${n}`
}
