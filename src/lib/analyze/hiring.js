// 채용 여력 — 사람을 더 뽑을 수 있는 회사인가.
//
// 인원과 인건비만 보면 "늘었다/줄었다"까지밖에 안 나온다. 지원자에게 중요한 건
// 그 증가를 매출이 따라오고 있는지다. 인건비가 매출보다 빨리 늘면 다음 해에
// 채용이 멈추거나 줄어든다 — 그 신호를 미리 읽는 게 이 계산의 목적이다.

import { growth } from './ratios.js'

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 매출 증가율이 인건비 증가율을 이 정도 이상 밑돌면 부담이 커진 것으로 본다(%p). */
const GAP_WARN = 10

/**
 * @param {{revenue?:{current:number,prior:number}, payroll?:{current:number,prior:number},
 *          headcount?:{current:number,prior:number}}} input
 */
export function hiringCapacity(input) {
  const revG = growth(n(input?.revenue?.current), n(input?.revenue?.prior))
  const payG = growth(n(input?.payroll?.current), n(input?.payroll?.prior))
  const headG = growth(n(input?.headcount?.current), n(input?.headcount?.prior))

  // 인당 매출이 늘었는지 — 사람을 늘린 만큼 성과가 따라왔는지를 한 수치로 본다.
  const perHead = (r, h) => (r != null && h ? r / h : null)
  const curPerHead = perHead(n(input?.revenue?.current), n(input?.headcount?.current))
  const priPerHead = perHead(n(input?.revenue?.prior), n(input?.headcount?.prior))
  const perHeadG = growth(curPerHead, priPerHead)

  // 인건비가 매출에서 차지하는 비중. 이 비중이 오르면 채용 여력이 준다.
  const share = (p, r) => (p != null && r ? (p / r) * 100 : null)
  const curShare = share(n(input?.payroll?.current), n(input?.revenue?.current))
  const priShare = share(n(input?.payroll?.prior), n(input?.revenue?.prior))

  const gap = revG != null && payG != null ? revG - payG : null

  let status = 'unknown'
  if (gap != null) {
    // 매출이 인건비보다 빨리 늘면 여력이 있고, 크게 뒤지면 부담이 커진 것이다.
    status = gap >= 0 ? 'good' : gap > -GAP_WARN ? 'info' : 'warn'
  }

  return {
    revenueGrowth: revG,
    payrollGrowth: payG,
    headcountGrowth: headG,
    perHeadRevenue: curPerHead,
    perHeadRevenueGrowth: perHeadG,
    payrollShare: curShare,
    payrollSharePrior: priShare,
    payrollShareDelta: curShare != null && priShare != null ? curShare - priShare : null,
    gap,
    status,
  }
}

/** 화면에 그대로 쓸 한 줄 해석. 결론이 아니라 무엇을 확인해야 하는지로 쓴다. */
export function hiringVerdict(h) {
  if (h?.gap == null) return null
  if (h.status === 'good') {
    return '매출이 인건비보다 빠르게 늘었습니다. 늘린 인원이 매출로 이어지는 구간이라 채용 여력이 있습니다.'
  }
  if (h.status === 'info') {
    return '인건비가 매출보다 조금 빠르게 늘었습니다. 아직 감당 범위지만 이 추세가 이어지면 채용 속도가 줄어듭니다.'
  }
  return '인건비가 매출보다 크게 빠르게 늘었습니다. 사람을 늘린 만큼 매출이 따라오지 못한 해라, 다음 해 채용이 줄거나 멈출 수 있습니다.'
}
