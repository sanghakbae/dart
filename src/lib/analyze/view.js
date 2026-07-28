// 화면용 파생 데이터. 계산 규칙을 탭마다 흩뿌리지 않기 위해 한 곳에 모아둔다.

import { growth, GROWTH_KEYS } from './ratios.js'

// worse: 늘어나는 게 나쁜 항목. 카드 색이 '늘었으니 초록' 으로 가지 않게 한다
// (부채총계가 38% 늘었는데 초록으로 떠서 좋은 일처럼 보였다).
export const HEADLINE = [
  { key: 'revenue', label: '매출액' },
  { key: 'operatingProfit', label: '영업이익' },
  { key: 'netIncome', label: '당기순이익' },
  { key: 'totalAssets', label: '자산총계' },
  { key: 'totalLiabilities', label: '부채총계', worseWhenUp: true },
  { key: 'totalEquity', label: '자본총계' },
  { key: 'cfOperating', label: '영업활동현금흐름' },
  { key: 'cash', label: '현금및현금성자산' },
]

export function headlineTiles(values) {
  return HEADLINE.map((h) => {
    const row = values?.[h.key]
    return {
      key: h.key,
      label: h.label,
      value: row?.current ?? null,
      prior: row?.prior ?? null,
      delta: growth(row?.current ?? null, row?.prior ?? null),
      worseWhenUp: Boolean(h.worseWhenUp),
      derived: Boolean(row?.derived),
    }
  }).filter((t) => t.value != null || t.prior != null)
}

export function growthRows(values) {
  return GROWTH_KEYS.map((k) => {
    const row = values?.[k.key]
    return {
      key: k.key,
      label: k.label,
      current: row?.current ?? null,
      prior: row?.prior ?? null,
      value: growth(row?.current ?? null, row?.prior ?? null),
    }
  }).filter((r) => r.value != null)
}

/** 손익 워터폴 단계. 없는 항목은 건너뛰고 합계 항목만이라도 이어 붙인다. */
export function waterfallSteps(values, period = 'current') {
  const v = (k) => values?.[k]?.[period] ?? null
  const steps = []
  const push = (label, value, total = false) => {
    if (value == null) return
    steps.push({ label, value, total })
  }

  push('매출액', v('revenue'), true)
  if (v('cogs') != null) push('매출원가', -Math.abs(v('cogs')))
  push('매출총이익', v('grossProfit'), true)
  if (v('sgna') != null) push('판관비', -Math.abs(v('sgna')))
  push('영업이익', v('operatingProfit'), true)

  const other = [
    ['기타수익', v('otherIncome')],
    ['기타비용', v('otherExpense') != null ? -Math.abs(v('otherExpense')) : null],
    ['금융수익', v('financeIncome')],
    ['금융원가', v('financeCost') != null ? -Math.abs(v('financeCost')) : null],
  ]
  for (const [label, val] of other) if (val != null) push(label, val)

  if (v('pretaxProfit') != null) push('법인세차감전', v('pretaxProfit'), true)
  if (v('incomeTax') != null) push('법인세비용', -Math.abs(v('incomeTax')))
  push('당기순이익', v('netIncome'), true)

  // 합계가 하나뿐이면 워터폴로서 의미가 없다.
  return steps.filter((s) => s.value !== 0 || s.total).length >= 3 ? steps : []
}

export function assetSlices(values, period = 'current') {
  const v = (k) => values?.[k]?.[period] ?? null
  const named = [
    ['현금및현금성자산', v('cash')],
    ['매출채권', v('tradeReceivables')],
    ['재고자산', v('inventories')],
    ['유형자산', v('ppe')],
    ['무형자산', v('intangibles')],
    ['투자자산', v('investments')],
  ].filter(([, val]) => val != null && val > 0)

  const total = v('totalAssets')
  const sum = named.reduce((a, [, x]) => a + x, 0)
  const slices = named.map(([label, value]) => ({ label, value }))
  if (total != null && total - sum > total * 0.03) slices.push({ label: '기타', value: total - sum })
  return slices
}

export function liabilitySlices(values, period = 'current') {
  const v = (k) => values?.[k]?.[period] ?? null
  return [
    { label: '유동부채', value: v('currentLiabilities') },
    { label: '비유동부채', value: v('nonCurrentLiabilities') },
  ].filter((s) => s.value != null && s.value > 0)
}

export function equitySlices(values, period = 'current') {
  const v = (k) => values?.[k]?.[period] ?? null
  return [
    { label: '자본금', value: v('capitalStock') },
    { label: '자본잉여금', value: v('capitalSurplus') },
    { label: '이익잉여금', value: v('retainedEarnings') },
    { label: '기타자본항목', value: v('otherEquity') },
    { label: '비지배지분', value: v('nonControlling') },
  ].filter((s) => s.value != null && s.value > 0)
}

/** 재무제표 탭에서 쓰는 당기/전기/증감 행 */
export function comparisonRows(items) {
  return items.map((it) => {
    const cur = it.scaled?.[0] ?? it.values?.[0] ?? null
    const pri = it.scaled?.[1] ?? it.values?.[1] ?? null
    return {
      label: it.label || it.rawLabel,
      rawLabel: it.rawLabel,
      level: it.level ?? 1,
      isSum: (it.level ?? 1) === 0,
      values: { current: cur, prior: pri, diff: cur != null && pri != null ? cur - pri : null, rate: growth(cur, pri) },
    }
  })
}
