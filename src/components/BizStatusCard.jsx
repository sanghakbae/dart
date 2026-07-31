import { useCallback } from 'react'
import { Card, Tile, Callout } from './ui'
import { RemoteBar, RemoteEmpty } from './RemoteBar'
import { hasProxy } from '../lib/proxyBase.js'
import { fetchBizStatus } from '../lib/externals'
import { loadBizStatus, saveBizStatus } from '../lib/storage'
import { useCachedRemote } from '../lib/useCachedRemote'
import { dateText } from '../lib/format'

/**
 * 국세청 사업자 상태.
 *
 * 감사보고서만 보면 그 회사가 지금도 영업 중인지 알 수 없다. 마지막 보고서가
 * 2년 전이면 폐업한 것인지 공시가 늦은 것인지 구분이 안 된다. 국세청 상태조회는
 * 계속·휴업·폐업과 폐업일을 바로 답한다 — 재무제표를 읽기 전에 볼 값이다.
 *
 * 부가세 과세유형은 규모의 단서다. 감사받는 법인이 간이과세일 수는 없으므로,
 * 일반과세가 아니면 회사를 잘못 짚었을 가능성을 의심해야 한다.
 */
// Tile 의 점 색 이름을 따른다(ui.jsx toneColor).
const TONE = {
  '01': 'good', // 계속사업자
  '02': 'warn', // 휴업자
  '03': 'bad',  // 폐업자
}

export default function BizStatusCard({ report }) {
  const companyKey = report?.companyKey || null
  const company = report?.meta?.company || null
  const knownBizNo = report?.meta?.bizNo || null

  const { data, fetchedAt, stale, loading, fetching, phase, error, warning, fetchNow } = useCachedRemote({
    key: companyKey,
    load: loadBizStatus,
    save: saveBizStatus,
    ready: Boolean(company),
    fetch: useCallback((onPhase) => fetchBizStatus(company, knownBizNo, onPhase), [company, knownBizNo]),
  })

  if (loading) return null

  const bar = (
    <RemoteBar source="국세청" fetchedAt={fetchedAt} stale={stale} fetching={fetching} phase={phase} onFetch={fetchNow} />
  )

  if (!data?.status) {
    return (
      <Card title="사업자 상태" right={fetchedAt ? bar : null}>
        <RemoteEmpty
          source="국세청"
          title={fetchedAt ? (data?.message || '상태를 확인하지 못했습니다') : '아직 받아오지 않았습니다'}
          fetching={fetching}
          phase={phase}
          onFetch={fetchNow}
          error={error || (!hasProxy ? '배포본에는 조회용 프록시 주소가 설정되지 않았습니다.' : null)}
        >
          사업자등록번호는 감사보고서에 없습니다. DART 기업개황에서 번호를 찾아 국세청에 조회합니다.
        </RemoteEmpty>
      </Card>
    )
  }

  const tone = TONE[data.statusCode] || 'muted'
  const closed = data.statusCode === '03'

  return (
    <Card
      title="사업자 상태"
      sub={data.bizNoText ? `사업자등록번호 ${data.bizNoText}` : undefined}
      right={bar}
    >
      <div className="stack">
        {error && <Callout tone="warn">새로 받아오지 못해 저장된 값을 보여줍니다. ({error})</Callout>}
        {warning && <Callout tone="warn">받아왔지만 DB 에 저장하지 못했습니다. ({warning})</Callout>}

        {closed && (
          <Callout tone="critical">
            국세청에 <strong>폐업</strong>으로 등록된 사업자입니다
            {data.closedAt && <> (폐업일 {dateText(data.closedAt)})</>}. 아래 재무제표는 폐업 전 자료입니다.
          </Callout>
        )}
        {data.statusCode === '02' && (
          <Callout tone="warn">국세청에 <strong>휴업</strong>으로 등록돼 있습니다.</Callout>
        )}

        <div className="grid grid-tiles">
          <Tile label="영업 상태" value={data.status} tone={tone} alwaysBad={closed} />
          <Tile label="과세유형" value={data.taxType || '-'} />
          <Tile label="폐업일" value={data.closedAt ? dateText(data.closedAt) : '해당 없음'} />
          {data.taxTypeChangedAt && (
            <Tile label="과세유형 전환일" value={dateText(data.taxTypeChangedAt)} />
          )}
        </div>
      </div>
    </Card>
  )
}
