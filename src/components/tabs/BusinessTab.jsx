import { useCallback, useState } from 'react'
import { Card, Tile, Callout, Badge, KV, Empty } from '../ui'
import { RemoteBar, RemoteEmpty } from '../RemoteBar'
import { hasProxy } from '../../lib/proxyBase.js'
import { abbrev, full } from '../../lib/format'
import { fetchBizStatus, fetchProcurement } from '../../lib/externals'
import { loadBizStatus, saveBizStatus, loadProcurement, saveProcurement } from '../../lib/storage'
import { useCachedRemote } from '../../lib/useCachedRemote'

/**
 * 사업자 상태(국세청) · 공공조달 실적(조달청 나라장터).
 *
 * 감사보고서는 '그 시점' 의 회사만 말해 준다. 2023년 보고서가 아무리 멀쩡해도 지금
 * 폐업했으면 그게 가장 중요한 사실이라, 사업자 상태를 맨 위에 둔다.
 *
 * 조달 실적은 비상장사 매출을 뒷받침하는 거의 유일한 외부 근거다 —
 * 금액·발주기관·시점이 기관 자료로 남는다.
 *
 * 둘 다 사업자등록번호가 있어야 제대로 조회된다. 감사보고서 표지에서 번호를 못 읽으면
 * 국세청은 아예 부를 수 없고(추측하면 남의 회사가 나온다), 조달청은 상호로만 찾는다.
 */
export default function BusinessTab({ report }) {
  const companyKey = report?.companyKey || null
  const company = report?.meta?.company || null
  const bizNo = report?.meta?.bizNo || null

  return (
    <div className="stack-lg">
      <BizStatusCard companyKey={companyKey} company={company} bizNo={bizNo} />
      <ProcurementCard companyKey={companyKey} company={company} bizNo={bizNo} />
    </div>
  )
}

/** 1234567890 → 123-45-67890 */
function bizNoText(v) {
  const n = String(v || '').replace(/\D/g, '')
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : String(v || '-')
}

/** 계속사업자는 초록, 휴업은 주의, 폐업은 경고. 색만으로 읽지 않도록 문구를 함께 둔다. */
function statusTone(code, status) {
  const s = `${code || ''}${status || ''}`
  if (/03|폐업/.test(s)) return 'bad'
  if (/02|휴업/.test(s)) return 'warn'
  return 'good'
}

function BizStatusCard({ companyKey, company, bizNo }) {
  const clean = String(bizNo || '').replace(/\D/g, '')
  const ready = clean.length === 10

  const { data, fetchedAt, stale, loading, fetching, error, warning, fetchNow } = useCachedRemote({
    key: companyKey,
    load: loadBizStatus,
    save: saveBizStatus,
    ready,
    fetch: useCallback(() => fetchBizStatus(clean), [clean]),
  })

  if (loading) return <Card title="사업자 상태"><div className="tnote">저장된 사업자 상태를 확인하는 중…</div></Card>

  // 번호가 없으면 버튼을 줘도 누를 수 없다. 왜 못 부르는지만 알려 준다.
  if (!ready) {
    return (
      <Card title="사업자 상태">
        <Empty title="사업자등록번호를 읽지 못했습니다">
          국세청 조회는 사업자등록번호 10자리로만 됩니다. 상호로는 조회되지 않고, 번호를 추측하면
          남의 회사 상태를 보여 주게 됩니다. 표지에 번호가 있는 보고서를 올리면 자동으로 받아 둡니다.
        </Empty>
      </Card>
    )
  }

  const bar = (
    <RemoteBar source="국세청" fetchedAt={fetchedAt} stale={stale} fetching={fetching} onFetch={fetchNow} />
  )

  if (!data?.bizNo) {
    return (
      <Card title="사업자 상태" right={fetchedAt ? bar : null}>
        <RemoteEmpty
          source="국세청"
          title={fetchedAt ? '국세청에서 확인되지 않았습니다' : '아직 받아오지 않았습니다'}
          fetching={fetching}
          onFetch={fetchNow}
          error={error || (!hasProxy ? '배포본에는 조회용 프록시 주소가 설정되지 않았습니다.' : null)}
        >
          {`사업자등록번호 ${bizNoText(clean)} 기준으로 계속·휴업·폐업과 부가세 과세유형을 확인합니다.`}
        </RemoteEmpty>
      </Card>
    )
  }

  const tone = statusTone(data.statusCode, data.status)

  return (
    <Card title="사업자 상태" sub={bizNoText(data.bizNo)} right={bar}>
      <div className="stack">
        {error && <Callout tone="warn">새로 받아오지 못해 저장된 값을 보여줍니다. ({error})</Callout>}
        {warning && <Callout tone="warn">받아왔지만 DB 에 저장하지 못했습니다. 화면을 다시 열면 사라집니다. ({warning})</Callout>}

        {!data.registered && (
          <Callout tone="warn">
            국세청에 등록되지 않은 사업자등록번호입니다. 표지에서 번호를 잘못 읽었거나,
            법인 번호가 아닌 다른 번호일 수 있습니다.
          </Callout>
        )}

        {data.registered && (
          <>
            <div className="grid grid-tiles">
              <Tile label="영업 상태" value={data.status} tone={tone === 'good' ? 'good' : tone} />
              <Tile label="과세유형" value={data.taxType || '-'} />
              {data.closedAt && <Tile label="폐업일" value={data.closedAt} tone="bad" />}
            </div>
            {tone === 'bad' && (
              <Callout tone="warn">
                폐업한 사업자입니다{data.closedAt ? ` (${data.closedAt})` : ''}.
                이 화면의 재무 수치는 폐업 전 보고서 기준입니다.
              </Callout>
            )}
            {tone === 'warn' && <Callout tone="warn">휴업 중인 사업자입니다.</Callout>}
            <KV
              items={[
                { k: '상태', v: <Badge tone={tone}>{data.status}</Badge> },
                data.taxType && { k: '부가세 과세유형', v: data.taxType },
                data.taxTypeChangedAt && { k: '과세유형 전환일', v: data.taxTypeChangedAt },
                data.previousTaxType && { k: '직전 과세유형', v: data.previousTaxType },
                data.unitTaxable !== null && { k: '단위과세 전환', v: data.unitTaxable ? '예' : '아니오' },
              ]}
            />
          </>
        )}
      </div>
    </Card>
  )
}

/** 조회 기간 선택지(개월). 상류가 1개월씩만 받아 개월 수가 곧 호출 수다. */
const MONTHS = [12, 36, 60]

function ProcurementCard({ companyKey, company, bizNo }) {
  const [months, setMonths] = useState(MONTHS[0])
  const clean = String(bizNo || '').replace(/\D/g, '')

  const { data, fetchedAt, stale, loading, fetching, error, warning, fetchNow } = useCachedRemote({
    key: companyKey,
    load: loadProcurement,
    save: saveProcurement,
    ready: Boolean(company || clean.length === 10),
    fetch: useCallback(() => fetchProcurement(company, clean, months), [company, clean, months]),
  })

  const awards = data?.awards || []

  if (loading) return <Card title="공공조달 실적"><div className="tnote">저장된 조달 실적을 확인하는 중…</div></Card>

  // 기간 선택은 '무엇을 받아올지' 를 정하는 것이라 받아오기 버튼 옆에 둔다.
  const bar = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <label className="chip">
        기간
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          style={{ marginLeft: 6, background: 'transparent', border: 0, color: 'inherit' }}
        >
          {MONTHS.map((m) => (
            <option key={m} value={m}>{`최근 ${m / 12}년`}</option>
          ))}
        </select>
      </label>
      <RemoteBar source="나라장터" fetchedAt={fetchedAt} stale={stale} fetching={fetching} onFetch={fetchNow} />
    </div>
  )

  if (!awards.length) {
    return (
      <Card title="공공조달 실적" right={fetchedAt ? bar : null}>
        <RemoteEmpty
          source="나라장터"
          title={fetchedAt ? `최근 ${data?.months ?? months}개월 낙찰 실적이 없습니다` : '아직 받아오지 않았습니다'}
          fetching={fetching}
          onFetch={fetchNow}
          error={error || (!hasProxy ? '배포본에는 조회용 프록시 주소가 설정되지 않았습니다.' : null)}
        >
          {fetchedAt
            ? '공공기관 발주가 없는 회사이거나, 조달을 관계사·대리점 명의로 받은 경우입니다.'
            : `조달청은 조회 기간이 1개월 제한이라 ${months}개월이면 상류를 ${months}번 부릅니다. 그래서 자동으로 받지 않습니다.`}
          {!fetchedAt && clean.length !== 10 && ' 사업자등록번호를 읽지 못해 상호로 찾습니다 — 동명 업체가 섞일 수 있습니다.'}
        </RemoteEmpty>
      </Card>
    )
  }

  const top = awards.reduce((m, a) => ((a.amount || 0) > (m?.amount || 0) ? a : m), null)

  return (
    <div className="stack-lg">
      <Card title="공공조달 실적" sub={`${data.query} · 최근 ${data.months}개월`} right={bar}>
        <div className="stack">
          {error && <Callout tone="warn">새로 받아오지 못해 저장된 값을 보여줍니다. ({error})</Callout>}
          {warning && <Callout tone="warn">받아왔지만 DB 에 저장하지 못했습니다. 화면을 다시 열면 사라집니다. ({warning})</Callout>}
          <div className="grid grid-tiles">
            <Tile label="낙찰" value={data.total} suffix="건" />
            <Tile label="낙찰금액 합계" value={abbrev(data.amount)} hint={`${full(data.amount)}원`} />
            {top && <Tile label="최대 건" value={abbrev(top.amount)} hint={top.title} />}
          </div>
          {clean.length !== 10 && (
            <Callout tone="warn">
              사업자등록번호가 없어 상호({data.query})로 찾았습니다. 동명 업체의 낙찰이 섞일 수 있습니다.
            </Callout>
          )}
          {data.truncated && (
            <Callout tone="warn">
              조회 호출 상한에 걸려 일부 기간만 확인했습니다. 실제 실적은 이보다 많을 수 있습니다.
            </Callout>
          )}
        </div>
      </Card>

      {data.byYear?.length > 1 && (
        <Card title="연도별 낙찰" sub="개찰일 기준" tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr><th>연도</th><th>건수</th><th>낙찰금액</th></tr>
              </thead>
              <tbody>
                {data.byYear.map((y) => (
                  <tr key={y.year}>
                    <td>{y.year}</td>
                    <td>{y.count}</td>
                    <td title={`${full(y.amount)}원`}>{abbrev(y.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="낙찰 목록" sub={`${awards.length}건 · 개찰일 최근순`} tight>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>개찰일</th>
                <th>공고명</th>
                <th>수요기관</th>
                <th>낙찰금액</th>
                <th>공고번호</th>
              </tr>
            </thead>
            <tbody>
              {awards.map((a) => (
                <tr key={`${a.bidNo}-${a.order || ''}`}>
                  <td>{a.openedAt || '-'}</td>
                  <td className="txt" style={{ whiteSpace: 'normal', maxWidth: '30em' }}>{a.title || '-'}</td>
                  <td className="txt">{a.demandInstitution || a.noticeInstitution || '-'}</td>
                  <td title={a.amount != null ? `${full(a.amount)}원` : undefined}>{abbrev(a.amount)}</td>
                  <td style={{ color: 'var(--text-3)' }}>{a.bidNo || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
