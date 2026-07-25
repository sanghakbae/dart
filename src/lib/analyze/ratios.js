// 재무비율. 값이 없으면 조용히 null 로 두고 화면에서 '-' 로 표시한다.

const pct = (a, b) => (a != null && b != null && b !== 0 ? (a / b) * 100 : null)
const times = (a, b) => (a != null && b != null && b !== 0 ? a / b : null)

export const RATIO_GROUPS = [
  {
    key: 'profitability',
    label: '수익성',
    hint: '벌어들이는 힘. 매출 대비·자본 대비 이익 수준을 본다.',
    ratios: [
      { key: 'grossMargin', label: '매출총이익률', unit: '%', good: 'high', fn: (v) => pct(g(v, 'grossProfit'), g(v, 'revenue')) },
      { key: 'opMargin', label: '영업이익률', unit: '%', good: 'high', fn: (v) => pct(g(v, 'operatingProfit'), g(v, 'revenue')) },
      { key: 'netMargin', label: '순이익률', unit: '%', good: 'high', fn: (v) => pct(g(v, 'netIncome'), g(v, 'revenue')) },
      { key: 'roa', label: 'ROA (총자산이익률)', unit: '%', good: 'high', fn: (v) => pct(g(v, 'netIncome'), g(v, 'totalAssets')) },
      { key: 'roe', label: 'ROE (자기자본이익률)', unit: '%', good: 'high', fn: (v) => pct(g(v, 'netIncome'), g(v, 'totalEquity')) },
    ],
  },
  {
    key: 'stability',
    label: '안정성',
    hint: '버티는 힘. 빚의 크기와 단기 지급능력을 본다.',
    ratios: [
      { key: 'currentRatio', label: '유동비율', unit: '%', good: 'high', bench: 100, fn: (v) => pct(g(v, 'currentAssets'), g(v, 'currentLiabilities')) },
      { key: 'debtRatio', label: '부채비율', unit: '%', good: 'low', bench: 200, fn: (v) => pct(g(v, 'totalLiabilities'), g(v, 'totalEquity')) },
      { key: 'equityRatio', label: '자기자본비율', unit: '%', good: 'high', bench: 30, fn: (v) => pct(g(v, 'totalEquity'), g(v, 'totalAssets')) },
      { key: 'liabToAssets', label: '총자산 대비 부채', unit: '%', good: 'low', fn: (v) => pct(g(v, 'totalLiabilities'), g(v, 'totalAssets')) },
      {
        key: 'interestCoverage',
        label: '이자보상배율',
        unit: '배',
        good: 'high',
        bench: 1,
        fn: (v) => times(g(v, 'operatingProfit'), g(v, 'financeCost')),
      },
    ],
  },
  {
    key: 'activity',
    label: '활동성',
    hint: '자산을 얼마나 굴리는지. 회전율이 높으면 자산 활용이 효율적이다.',
    ratios: [
      { key: 'assetTurnover', label: '총자산회전율', unit: '회', good: 'high', fn: (v) => times(g(v, 'revenue'), g(v, 'totalAssets')) },
      { key: 'invTurnover', label: '재고자산회전율', unit: '회', good: 'high', fn: (v) => times(g(v, 'revenue'), g(v, 'inventories')) },
      { key: 'arTurnover', label: '매출채권회전율', unit: '회', good: 'high', fn: (v) => times(g(v, 'revenue'), g(v, 'tradeReceivables')) },
    ],
  },
  {
    key: 'cashflow',
    label: '현금흐름',
    hint: '이익이 실제 현금으로 들어오는지. 순이익만 크고 현금이 없으면 경고 신호다.',
    ratios: [
      { key: 'cfoMargin', label: '영업현금흐름 / 매출액', unit: '%', good: 'high', fn: (v) => pct(g(v, 'cfOperating'), g(v, 'revenue')) },
      { key: 'cfoToNi', label: '영업현금흐름 / 당기순이익', unit: '배', good: 'high', bench: 1, fn: (v) => times(g(v, 'cfOperating'), g(v, 'netIncome')) },
      { key: 'cfoToDebt', label: '영업현금흐름 / 총부채', unit: '%', good: 'high', fn: (v) => pct(g(v, 'cfOperating'), g(v, 'totalLiabilities')) },
    ],
  },
]

export const ALL_RATIOS = RATIO_GROUPS.flatMap((grp) => grp.ratios.map((r) => ({ ...r, group: grp.key, groupLabel: grp.label })))

function g(values, key) {
  const row = values?.[key]
  return row ? row.value : null
}

/** values: { key: {current, prior} } → { current: {ratioKey: n}, prior: {...} } */
export function computeRatios(values) {
  const out = {}
  for (const period of ['current', 'prior']) {
    const flat = {}
    for (const [k, row] of Object.entries(values || {})) {
      flat[k] = { value: row?.[period] ?? null }
    }
    out[period] = {}
    for (const r of ALL_RATIOS) {
      let v = null
      try {
        v = r.fn(flat)
      } catch {
        v = null
      }
      out[period][r.key] = Number.isFinite(v) ? v : null
    }
  }
  return out
}

/** 성장률(전기 → 당기). 전기가 음수면 부호 왜곡이 생기므로 절대값 기준으로 계산하고 표시한다. */
export function growth(current, prior) {
  if (current == null || prior == null || prior === 0) return null
  const rate = ((current - prior) / Math.abs(prior)) * 100
  return Number.isFinite(rate) ? rate : null
}

export const GROWTH_KEYS = [
  { key: 'revenue', label: '매출액' },
  { key: 'operatingProfit', label: '영업이익' },
  { key: 'netIncome', label: '당기순이익' },
  { key: 'totalAssets', label: '자산총계' },
  { key: 'totalEquity', label: '자본총계' },
  { key: 'totalLiabilities', label: '부채총계' },
  { key: 'cfOperating', label: '영업활동현금흐름' },
]

/** 자동 코멘트: 숫자에서 바로 읽히는 사실만 문장으로 만든다. */
export function buildInsights(values, ratios) {
  const out = []
  const cur = (k) => values?.[k]?.current ?? null
  const pri = (k) => values?.[k]?.prior ?? null
  const push = (tone, text) => out.push({ tone, text })

  const revG = growth(cur('revenue'), pri('revenue'))
  if (revG != null) {
    push(revG >= 0 ? 'good' : 'warn', `매출액이 전년 대비 ${fmtSigned(revG)}% ${revG >= 0 ? '증가' : '감소'}했습니다.`)
  }
  const opG = growth(cur('operatingProfit'), pri('operatingProfit'))
  if (opG != null && revG != null) {
    if (opG < revG - 5) push('warn', `영업이익 증가율(${fmtSigned(opG)}%)이 매출 증가율(${fmtSigned(revG)}%)보다 낮습니다. 원가·판관비 부담이 커졌습니다.`)
    else if (opG > revG + 5) push('good', `영업이익 증가율(${fmtSigned(opG)}%)이 매출 증가율을 앞섰습니다. 수익구조가 개선됐습니다.`)
  }
  if (cur('operatingProfit') != null && cur('operatingProfit') < 0) push('bad', '당기 영업손실이 발생했습니다.')
  if (cur('netIncome') != null && cur('netIncome') < 0) push('bad', '당기순손실이 발생했습니다.')

  const dr = ratios?.current?.debtRatio
  const drPrev = ratios?.prior?.debtRatio
  if (dr != null) {
    const tone = dr > 200 ? 'bad' : dr > 100 ? 'warn' : 'good'
    const move = drPrev != null ? ` (전기 ${fmtNum(drPrev)}%)` : ''
    push(tone, `부채비율 ${fmtNum(dr)}%${move}${dr > 200 ? ' — 통상 200%를 넘으면 재무 부담이 큰 것으로 봅니다.' : ''}`)
  }
  const cr = ratios?.current?.currentRatio
  if (cr != null && cr < 100) push('warn', `유동비율 ${fmtNum(cr)}% — 1년 내 갚을 돈이 1년 내 현금화할 자산보다 많습니다.`)

  const cfo = cur('cfOperating')
  const ni = cur('netIncome')
  if (cfo != null && cfo < 0) push('bad', '영업활동 현금흐름이 마이너스입니다. 본업에서 현금이 빠져나갔습니다.')
  else if (cfo != null && ni != null && ni > 0 && cfo < ni * 0.5) {
    push('warn', '당기순이익 대비 영업활동 현금흐름이 절반 이하입니다. 이익의 현금 전환이 약합니다.')
  }

  const re = cur('retainedEarnings')
  const cap = cur('capitalStock')
  if (re != null && re < 0) push('bad', `이익잉여금이 결손 상태입니다${cap != null && Math.abs(re) > cap ? ' (자본금 초과 결손 — 자본잠식 가능성).' : '.'}`)

  return out
}

export function fmtSigned(n) {
  if (n == null) return '-'
  return `${n > 0 ? '+' : ''}${fmtNum(n)}`
}
export function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString('ko-KR', { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 })
}
