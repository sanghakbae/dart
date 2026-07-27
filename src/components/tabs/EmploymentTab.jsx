import { useEffect, useMemo, useState } from 'react'
import { Card, Tile, Empty, Callout, Badge } from '../ui'
import { fetchEmployment, yearlyAverages, turnoverRate } from '../../lib/nps/api'
import { loadEmployment, saveEmployment } from '../../lib/storage'
import { hasProxy } from '../../lib/proxyBase.js'
import { abbrev, full, dateTimeText } from '../../lib/format'
import { HeadcountChart } from '../charts'

/**
 * 고용 현황. 감사보고서에는 인원 정보가 없어 국민연금에서 따로 받아 온다.
 *
 * 1인당 인건비는 감사보고서의 종업원급여(주석 '비용의 성격별 분류')를 인원으로 나눈 값이다.
 * 국민연금 고지금액으로 역산한 평균보수는 기준소득월액 상한에 걸려 낮게 나오므로
 * 둘을 같이 보여주고 차이를 밝힌다.
 */
export default function EmploymentTab({ report, timeline }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const company = report?.meta?.company
  const bizNo = report?.meta?.bizNo || null
  const companyKey = report?.companyKey || null

  /**
   * DB 우선. 하루가 지났거나 캐시가 없을 때만 국민연금 API 를 부른다.
   * (한 회사 조회에 상류 호출이 여러 번 들어가고 개발계정은 일 1,000건 한도다)
   */
  useEffect(() => {
    if (!company) return
    let alive = true
    setLoading(true)
    setError(null)

    const pull = async (force) => {
      const cached = force ? null : await loadEmployment(companyKey)
      if (cached && !cached.stale) return { payload: cached, from: 'db' }

      try {
        const fresh = await fetchEmployment(company, bizNo)
        const saved = await saveEmployment(companyKey, { ...fresh, name: company, bizNo })
        return { payload: { ...fresh, fetchedAt: Date.now() }, from: 'api', warning: saved.warning }
      } catch (e) {
        // 새로 받는 데 실패하면 오래된 캐시라도 보여준다.
        if (cached) return { payload: cached, from: 'db-stale', warning: e.message }
        throw e
      }
    }

    pull(reloadKey > 0)
      .then(({ payload, warning }) => {
        if (!alive) return
        setData(payload)
        setFetchedAt(payload.fetchedAt || null)
        if (warning) setError(warning)
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => {
        if (!alive) return
        setLoading(false)
        setRefreshing(false)
      })
    return () => {
      alive = false
    }
  }, [company, bizNo, companyKey, reloadKey])

  const refresh = () => {
    setRefreshing(true)
    setReloadKey((k) => k + 1)
  }

  const months = data?.months || []
  const years = useMemo(() => yearlyAverages(months), [months])
  const turnover = useMemo(() => turnoverRate(months), [months])
  const latest = months[months.length - 1] || null

  // 인당 매출·인당 인건비 — 연도별 평균 인원으로 나눈다.
  const perHead = useMemo(() => {
    const out = []
    for (const y of years) {
      const row = timeline?.rows?.find((r) => r.year === y.year)
      const revenue = row?.revenue ?? null
      const payroll = report?.payroll?.total
      const payrollAmt =
        report?.meta?.fiscalYear === y.year ? payroll?.current : report?.meta?.fiscalYear === y.year + 1 ? payroll?.prior : null
      out.push({
        year: y.year,
        avgHeadcount: y.avgHeadcount,
        monthCount: y.monthCount,
        revenuePerHead: revenue != null && y.avgHeadcount ? revenue / y.avgHeadcount : null,
        payrollPerHead: payrollAmt != null && y.avgHeadcount ? payrollAmt / y.avgHeadcount : null,
      })
    }
    return out
  }, [years, timeline, report])

  if (loading) return <Card><Empty title="국민연금에서 고용 정보를 불러오는 중입니다…" /></Card>

  // 갱신 시각과 다시 받기. DB 캐시를 쓰기 때문에 언제 받은 값인지 밝혀 둔다.
  const freshness = (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="chip">
        {fetchedAt ? `${dateTimeText(fetchedAt)} 기준` : '갱신 시각 미확인'}
      </span>
      <button className="btn btn-sm btn-ghost" type="button" onClick={refresh} disabled={refreshing}>
        {refreshing ? '받는 중…' : '지금 다시 받기'}
      </button>
    </div>
  )

  // 새로 받는 데 실패했어도 예전 캐시가 있으면 그걸 보여주고 경고만 띄운다.
  if (error && data?.found && months.length) {
    // 아래 본문을 그대로 렌더하고, 맨 위에 경고를 얹는다.
  } else if (error) {
    return (
      <Card title="고용 현황">
        <Callout tone="warn">
          {error}
          <br />
          {hasProxy
            ? '국민연금 인증키(NPS_API_KEY)가 프록시에 설정되어 있어야 합니다. 개발 서버는 .env, 배포본은 Worker 시크릿에서 읽습니다.'
            : '배포본에는 조회용 프록시 주소가 설정되지 않았습니다. VITE_PROXY_BASE 에 Worker 주소를 넣어 배포하면 동작합니다.'}
        </Callout>
      </Card>
    )
  }

  if (!data?.found || !months.length) {
    return (
      <Card title="고용 현황" right={freshness}>
        <Empty title={`${company} 의 국민연금 가입 사업장을 찾지 못했습니다`}>
          가입자 3인 이상 법인사업장만 공개됩니다. 사업장명이 감사보고서의 회사명과 다를 수 있습니다.
        </Empty>
      </Card>
    )
  }

  return (
    <div className="stack-lg">
      <Card
        title="고용 현황"
        sub={`${data.workplace.name} · ${months[0].ym} ~ ${latest.ym}`}
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone="muted">국민연금</Badge>
            {freshness}
          </div>
        }
      >
        <div className="stack">
          {error && (
            <Callout tone="warn">
              새로 받아오지 못해 저장된 값을 보여줍니다. ({error})
            </Callout>
          )}
          <div className="grid grid-tiles">
            <Tile label={`${latest.ym} 인원`} value={latest.headcount} suffix="명" />
            <Tile label="입사" value={latest.joined} suffix="명" />
            <Tile label="퇴사" value={latest.left} suffix="명" />
            {turnover && (
              <Tile
                label="연간 퇴사율"
                value={`${turnover.rate.toFixed(1)}%`}
                unit={`최근 ${turnover.months}개월 퇴사 ${turnover.left}명`}
                tone={turnover.rate >= 25 ? 'warn' : undefined}
              />
            )}
            {latest.avgMonthlyWage && (
              <Tile
                label="평균 기준소득월액"
                value={abbrev(latest.avgMonthlyWage)}
                unit={`${full(latest.avgMonthlyWage)}원 · 상한 적용`}
              />
            )}
          </div>

          <HeadcountChart months={months} />

          <Callout>
            {data.note}
            {latest.avgMonthlyWage && (
              <>
                {' '}
                <strong>평균 기준소득월액</strong>은 국민연금 고지금액을 인원과 보험료율(9%)로 역산한 값입니다.
                상한(2025.7~ 637만원)이 있어 고소득자가 많으면 실제보다 낮게 나옵니다.
              </>
            )}
          </Callout>
        </div>
      </Card>

      <Card title="월별 내역" sub={`${months.length}개월`} tight>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>연월</th>
                <th className="num">인원</th>
                <th className="num">입사</th>
                <th className="num">퇴사</th>
                <th className="num">고지금액</th>
                <th className="num">평균 기준소득월액</th>
              </tr>
            </thead>
            <tbody>
              {[...months].reverse().map((m) => (
                <tr key={m.ym}>
                  <td>{m.ym}</td>
                  <td className="num">{m.headcount ?? '-'}</td>
                  <td className="num">{m.joined ?? '-'}</td>
                  <td className="num">{m.left ?? '-'}</td>
                  <td className="num">{m.noticeAmount != null ? full(m.noticeAmount) : '-'}</td>
                  <td className="num">{m.avgMonthlyWage != null ? full(m.avgMonthlyWage) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {perHead.some((r) => r.revenuePerHead != null || r.payrollPerHead != null) && (
        <Card title="1인당 지표" sub="국민연금 평균 인원 기준" tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>연도</th>
                  <th className="num">평균 인원</th>
                  <th className="num">1인당 매출</th>
                  <th className="num">1인당 인건비</th>
                </tr>
              </thead>
              <tbody>
                {perHead.map((r) => (
                  <tr key={r.year}>
                    <td>
                      {r.year}년
                      {r.monthCount < 12 && <span className="tnote"> ({r.monthCount}개월분)</span>}
                    </td>
                    <td className="num">{r.avgHeadcount.toFixed(1)}명</td>
                    <td className="num">{r.revenuePerHead != null ? `${abbrev(r.revenuePerHead)}원` : '-'}</td>
                    <td className="num">{r.payrollPerHead != null ? `${abbrev(r.payrollPerHead)}원` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {report?.payroll && (
        <Card title="인건비 (감사보고서 주석)" sub={`출처: 비용의 성격별 분류 · ${report.payroll.source}`} tight>
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="num">당기</th>
                  <th className="num">전기</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(report.payroll.values).map((v) => (
                  <tr key={v.label}>
                    <td>{v.label}</td>
                    <td className="num">{v.current != null ? full(v.current) : '-'}</td>
                    <td className="num">{v.prior != null ? full(v.prior) : '-'}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>합계</strong></td>
                  <td className="num"><strong>{report.payroll.total.current != null ? full(report.payroll.total.current) : '-'}</strong></td>
                  <td className="num"><strong>{report.payroll.total.prior != null ? full(report.payroll.total.prior) : '-'}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
