// 국민연금 월별 시계열에서 뽑아내는 계산.
//
// 네트워크와 분리해 둔다 — 프록시 모듈(proxyBase.js)은 import.meta.env 를 읽어
// 브라우저 밖에서는 불러올 수 없고, 그것 때문에 이 순수 계산에 테스트를 붙이지
// 못했다. 여기 있는 함수는 전부 입력만 보고 값을 낸다.

/** 사업연도별 평균 인원 — 인당 매출·인당 인건비 계산에 쓴다. */
export function yearlyAverages(months = []) {
  const byYear = new Map()
  for (const m of months) {
    const y = Number(String(m.ym).slice(0, 4))
    if (!Number.isFinite(y) || m.headcount == null) continue
    const g = byYear.get(y) || { year: y, sum: 0, n: 0, joined: 0, left: 0 }
    g.sum += m.headcount
    g.n += 1
    g.joined += m.joined ?? 0
    g.left += m.left ?? 0
    byYear.set(y, g)
  }
  return [...byYear.values()]
    .map((g) => ({ year: g.year, avgHeadcount: g.sum / g.n, monthCount: g.n, joined: g.joined, left: g.left }))
    .sort((a, b) => a.year - b.year)
}

/**
 * 연간 퇴사율 = 기간 퇴사자 합 ÷ 같은 기간 평균 인원, 12개월로 환산.
 * (혁신의숲과 같은 산식 — 무하유 25.6% 로 대조 확인했다)
 *
 * 받은 개월 수만큼만 센다. 12개월을 주면 예전과 같은 값이 나오고,
 * 24·36개월을 주면 연율로 환산해 기간이 달라도 견줄 수 있게 한다.
 */
export function turnoverRate(months = []) {
  if (months.length < 2) return null
  const counts = months.map((m) => m.headcount).filter((v) => v != null)
  if (!counts.length) return null
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length
  const left = months.reduce((a, m) => a + (m.left ?? 0), 0)
  if (!avg) return null
  return { rate: (left / avg) * (12 / months.length) * 100, left, avg, months: months.length }
}

/** 기간 합계·평균 — KPI 카드가 고른 기간을 그대로 따르게 한다. */
export function periodSummary(months = []) {
  if (!months.length) return null
  const sum = (k) => months.reduce((a, m) => a + (m[k] ?? 0), 0)
  const wages = months.map((m) => m.avgMonthlyWage).filter((v) => v != null)
  const first = months[0]
  const last = months[months.length - 1]
  return {
    months: months.length,
    from: first.ym,
    to: last.ym,
    joined: sum('joined'),
    left: sum('left'),
    // 기간 평균 보수. 한 달치만 보면 상여 지급월에 튄다.
    avgMonthlyWage: wages.length ? Math.round(wages.reduce((a, b) => a + b, 0) / wages.length) : null,
    // 기간 시작 대비 인원 증감
    headcountFrom: first.headcount ?? null,
    headcountTo: last.headcount ?? null,
  }
}
