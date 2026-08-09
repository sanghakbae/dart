// 런웨이 — 지금 속도로 현금을 태우면 몇 개월 버티는가.
//
// 적자 회사를 볼 때 투자자도 지원자도 결국 이걸 묻는다. 재무비율은 "영업이익률이
// 몇 %인가"까지만 답하고, "그래서 언제 돈이 떨어지나"는 답하지 않는다.
//
// 두 기준을 함께 낸다. 하나만 쓰면 둘 다 오해를 부른다.
//   영업 기준   : 영업활동현금흐름만. 장사 자체로 얼마나 태우는가.
//   영업+투자   : 잉여현금흐름(FCF). 설비·개발 투자까지 포함한 실제 소진.
// 영업+투자 기준은 여유자금을 단기금융상품에 옮긴 것까지 '소진'으로 잡아 과대평가될
// 수 있다. 그래서 보유 현금에 단기금융상품을 포함시켜 같은 눈높이로 맞춘다.

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** 몇 개월 남았을 때 어떤 신호로 볼지. 업종 무관 일반값이라 결론이 아니라 신호다. */
export const RUNWAY_BANDS = [
  { max: 6, tone: 'bad', label: '6개월 미만' },
  { max: 12, tone: 'warn', label: '1년 미만' },
  { max: 24, tone: 'info', label: '2년 미만' },
  { max: Infinity, tone: 'good', label: '2년 이상' },
]

function bandOf(months) {
  if (months == null) return null
  return RUNWAY_BANDS.find((b) => months < b.max) || RUNWAY_BANDS[RUNWAY_BANDS.length - 1]
}

/**
 * @param {object} values 보고서의 계정 값 { key: {current, prior} }
 * @returns {{
 *   cash: number|null, cashOnly: number|null, deposits: number|null,
 *   burnOperating: number|null, burnFree: number|null,
 *   monthsOperating: number|null, monthsFree: number|null,
 *   months: number|null, basis: 'operating'|'free'|null,
 *   burning: boolean, band: object|null,
 * }}
 */
export function computeRunway(values) {
  const cur = (k) => n(values?.[k]?.current)

  const cashOnly = cur('cash')
  const deposits = cur('shortTermInvest')
  // 즉시 쓸 수 있는 돈. 단기금융상품은 예치일 뿐 사라진 돈이 아니다.
  const cash = cashOnly == null && deposits == null ? null : (cashOnly || 0) + (deposits || 0)

  const cfo = cur('cfOperating')
  const cfi = cur('cfInvesting')

  // 소진액은 '나가는 돈'이라 양수로 둔다. 들어오면 소진이 아니다(null).
  const burnOperating = cfo == null ? null : cfo < 0 ? -cfo : 0
  const free = cfo == null ? null : cfo + (cfi || 0)
  const burnFree = free == null ? null : free < 0 ? -free : 0

  const monthsOf = (burn) => (cash == null || !burn ? null : (cash / burn) * 12)
  const monthsOperating = monthsOf(burnOperating)
  const monthsFree = monthsOf(burnFree)

  // 둘 다 있으면 짧은 쪽이 실제로 마주할 시점이다.
  const months =
    monthsOperating != null && monthsFree != null
      ? Math.min(monthsOperating, monthsFree)
      : (monthsOperating ?? monthsFree)
  const basis =
    months == null ? null : months === monthsFree && monthsFree != null ? 'free' : 'operating'

  return {
    cash,
    cashOnly,
    deposits,
    burnOperating,
    burnFree,
    monthsOperating,
    monthsFree,
    months,
    basis,
    // 영업으로도 투자로도 돈이 나가지 않으면 태우는 중이 아니다.
    burning: Boolean((burnOperating || 0) > 0 || (burnFree || 0) > 0),
    band: bandOf(months),
  }
}

/** "약 7개월" 처럼 읽히게. 24개월이 넘으면 연 단위가 눈에 더 잘 들어온다. */
export function runwayText(months) {
  if (months == null) return '-'
  if (!Number.isFinite(months)) return '해당 없음'
  if (months >= 24) return `약 ${(months / 12).toFixed(1)}년`
  return `약 ${months.toFixed(months < 10 ? 1 : 0)}개월`
}
