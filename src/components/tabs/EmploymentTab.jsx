import { useCallback, useMemo } from 'react'
import { Card, Tile, Callout, Badge } from '../ui'
import { RemoteBar, RemoteEmpty } from '../RemoteBar'
import { fetchEmployment, yearlyAverages, turnoverRate } from '../../lib/nps/api'
import { loadEmployment, saveEmployment } from '../../lib/storage'
import { hasProxy } from '../../lib/proxyBase.js'
import { abbrev, full } from '../../lib/format'
import { useCachedRemote } from '../../lib/useCachedRemote'
import { HeadcountChart } from '../charts'

/**
 * 고용 현황. 감사보고서에는 인원 정보가 없어 국민연금에서 따로 받아 온다.
 *
 * 1인당 인건비는 감사보고서의 종업원급여(주석 '비용의 성격별 분류')를 인원으로 나눈 값이다.
 * 국민연금 고지금액으로 역산한 평균보수는 기준소득월액 상한에 걸려 낮게 나오므로
 * 둘을 같이 보여주고 차이를 밝힌다.
 */
export default function EmploymentTab({ report, timeline }) {
  const company = report?.meta?.company
  const bizNo = report?.meta?.bizNo || null
  const companyKey = report?.companyKey || null

  // 자동으로 받지 않는다. 한 회사 조회에 상류를 25회 안팎 두드리고 10초 가까이 걸린다.
  const { data, fetchedAt, stale, loading, fetching, error, fetchNow } = useCachedRemote({
    key: companyKey,
    load: loadEmployment,
    save: (k, v) => saveEmployment(k, { ...v, name: company, bizNo }),
    ready: Boolean(company),
    fetch: useCallback(() => fetchEmployment(company, bizNo), [company, bizNo]),
  })

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

  if (loading) return <Card><div className="tnote">저장된 고용 정보를 확인하는 중…</div></Card>

  const bar = (
    <RemoteBar source="국민연금" fetchedAt={fetchedAt} stale={stale} fetching={fetching} onFetch={fetchNow} />
  )

  if (!data?.found || !months.length) {
    return (
      <Card title="고용 현황" right={fetchedAt ? bar : null}>
        <RemoteEmpty
          source="국민연금"
          title={fetchedAt ? `${company} 의 국민연금 가입 사업장을 찾지 못했습니다` : '아직 받아오지 않았습니다'}
          fetching={fetching}
          onFetch={fetchNow}
          error={error || (!hasProxy ? '배포본에는 조회용 프록시 주소가 설정되지 않았습니다.' : null)}
        >
          {fetchedAt
            ? '가입자 3인 이상 법인사업장만 공개됩니다. 사업장명이 감사보고서의 회사명과 다를 수 있습니다.'
            : '조회에 10초쯤 걸려 자동으로 받지 않습니다. 한 번 받아오면 DB 에 저장해 두고 씁니다.'}
        </RemoteEmpty>
      </Card>
    )
  }

  return (
    <div className="stack-lg">
      <Card
        title="고용 현황"
        sub={`${data.workplace.name} · ${months[0].ym} ~ ${latest.ym}`}
        right={bar}
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
