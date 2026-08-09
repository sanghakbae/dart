import { Card, Tile, Callout, Badge } from './ui'
import { hiringCapacity, hiringVerdict } from '../lib/analyze/hiring'
import { abbrev, full, signedPct, pctText } from '../lib/format'

/**
 * 채용 여력 — 사람을 더 뽑을 수 있는 회사인가.
 *
 * 인원·인건비 절대값은 이미 위에서 보여 준다. 여기서는 그 증가를 매출이 따라오는지만 본다.
 * 인건비가 매출보다 빨리 늘면 다음 해 채용이 줄어드는 일이 잦아, 지원자에게는
 * "지금 몇 명인가" 보다 이쪽이 실질적인 정보다.
 */
export default function HiringCard({ report, perHead }) {
  const payroll = report?.payroll?.total
  const revenue = report?.values?.revenue

  // 국민연금 평균 인원(연도별)에서 당기·전기를 뽑는다. 감사보고서에는 인원이 없다.
  const fy = report?.meta?.fiscalYear
  const curHead = perHead?.find((r) => r.year === fy)?.avgHeadcount ?? null
  const priHead = perHead?.find((r) => r.year === fy - 1)?.avgHeadcount ?? null

  const h = hiringCapacity({
    revenue: { current: revenue?.current, prior: revenue?.prior },
    payroll: { current: payroll?.current, prior: payroll?.prior },
    headcount: { current: curHead, prior: priHead },
  })
  const verdict = hiringVerdict(h)
  if (!verdict) return null

  const tone = { good: 'good', info: 'info', warn: 'warn' }[h.status] || 'muted'

  return (
    <Card
      title="채용 여력"
      sub={`${fy}년 · 인건비 증가를 매출이 따라오는지`}
      right={
        <Badge tone={tone} dot>
          {h.status === 'good' ? '여력 있음' : h.status === 'info' ? '보통' : '부담 커짐'}
        </Badge>
      }
    >
      <div className="grid grid-tiles">
        <Tile label="매출 증가율" value={signedPct(h.revenueGrowth)} delta={h.revenueGrowth} deltaLabel="전년 대비" />
        <Tile label="인건비 증가율" value={signedPct(h.payrollGrowth)} delta={h.payrollGrowth} deltaLabel="전년 대비" />
        {h.headcountGrowth != null && (
          <Tile label="인원 증가율" value={signedPct(h.headcountGrowth)} delta={h.headcountGrowth} deltaLabel="전년 대비" />
        )}
        {h.payrollShare != null && (
          <Tile
            label="매출 대비 인건비"
            value={pctText(h.payrollShare)}
            unit={h.payrollShareDelta != null ? `전년 ${pctText(h.payrollSharePrior)}` : undefined}
            delta={h.payrollShareDelta}
            deltaLabel="%p"
          />
        )}
        {h.perHeadRevenue != null && (
          <Tile
            label="1인당 매출"
            value={abbrev(h.perHeadRevenue)}
            unit={`${full(Math.round(h.perHeadRevenue))}원`}
            delta={h.perHeadRevenueGrowth}
            deltaLabel="전년 대비"
          />
        )}
      </div>

      <Callout tone={h.status === 'warn' ? 'warn' : undefined}>{verdict}</Callout>

      <Callout>
        인건비는 감사보고서 주석(비용의 성격별 분류)의 종업원급여이고, 인원은 국민연금 가입자 수의
        연평균입니다. <strong>출처가 다르므로</strong> 등기임원·비정규 인력 처리에 따라 어긋날 수 있습니다.
      </Callout>
    </Card>
  )
}
