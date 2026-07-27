// 기업가치 추정.
//
// 감사보고서만으로는 '시장가치'를 알 수 없다(시가·거래사례·동종업계 배수가 없다).
// 대신 재무제표에서 곧바로 계산되는 세 가지 관점을 제시하고, 가정을 모두 드러낸다.
//   1) 순자산가치 — 자본총계(장부가). 청산가치에 가장 가깝다
//   2) 상속세및증여세법 보충적 평가방법 — 비상장주식 평가의 법정 산식
//   3) 배수법(PER·PBR·EV/EBITDA) — 배수는 사용자가 정한다
//
// 어느 것도 투자 판단의 근거가 아니며, 실제 거래가격은 성장성·경영권 프리미엄·
// 비상장 할인 등으로 크게 달라진다.

const CAPITALIZATION_RATE = 0.1 // 상증법 순손익가치 환원율 10%
const WEIGHTS = [3, 2, 1] // 최근 사업연도부터 3:2:1 가중

export const DEFAULT_MULTIPLES = { per: 10, pbr: 1.5, evEbitda: 8 }

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * @param {object} values 대표 계정 { key: {current, prior} }
 * @param {Array} timelineRows 연도별 값 (오래된 → 최근)
 * @param {object} shares 주주·주식 정보
 * @param {object} multiples 사용자가 정한 배수
 * @param {object|null} rcps 상환전환우선주 주석 (있으면 발행가 기준 밸류를 더한다)
 */
export function valuate(values, timelineRows = [], shares = null, multiples = DEFAULT_MULTIPLES, rcps = null) {
  const equity = num(values?.totalEquity?.current)
  const netIncome = num(values?.netIncome?.current)
  const operating = num(values?.operatingProfit?.current)
  const assets = num(values?.totalAssets?.current)
  const liabilities = num(values?.totalLiabilities?.current)
  const cash = num(values?.cash?.current)
  const debt = (num(values?.shortTermDebt?.current) ?? 0) + (num(values?.longTermDebt?.current) ?? 0)
  // 1주당 값의 분모.
  //
  // 상환전환우선주는 부채로 잡혀 자본총계에서 이미 빠져 있다. 그래서 위 방법들이
  // 내놓는 값은 '보통주 몫' 이고, 나눌 때도 보통주 수로 나눠야 앞뒤가 맞는다.
  // 총 주식수(보통주+우선주)로 나누면 분자와 분모의 기준이 어긋난다.
  const issued = num(shares?.commonShares ?? shares?.issuedShares) || null // 0주는 값이 없는 것과 같다

  const methods = []

  // 1) 순자산가치
  if (equity != null) {
    methods.push({
      key: 'book',
      label: '순자산가치 (장부가)',
      value: equity,
      basis: '자본총계',
      detail: `자산총계 ${fmt(assets)} − 부채총계 ${fmt(liabilities)}`,
      note: '회계장부상 가치입니다. 영업권·브랜드 같은 무형의 가치는 빠져 있고, 자산이 시가와 다르면 실제와 벌어집니다.',
    })
  }

  // 2) 상증법 보충적 평가방법
  const statutory = inheritanceTaxValue(values, timelineRows, issued)
  if (statutory) methods.push(statutory)

  // 3) 배수법
  if (netIncome != null && netIncome > 0 && multiples.per) {
    methods.push({
      key: 'per',
      label: `PER ${multiples.per}배`,
      value: netIncome * multiples.per,
      basis: '당기순이익 × PER',
      detail: `${fmt(netIncome)} × ${multiples.per}`,
      note: '이익이 그대로 유지된다고 볼 때의 값입니다. 적자면 계산되지 않습니다.',
      adjustable: true,
    })
  }
  if (equity != null && multiples.pbr) {
    methods.push({
      key: 'pbr',
      label: `PBR ${multiples.pbr}배`,
      value: equity * multiples.pbr,
      basis: '자본총계 × PBR',
      detail: `${fmt(equity)} × ${multiples.pbr}`,
      adjustable: true,
    })
  }
  if (operating != null && operating > 0 && multiples.evEbitda) {
    // 감가상각비는 감사보고서 본문에서 일관되게 뽑기 어려워 EBIT 기준으로 계산한다.
    const ev = operating * multiples.evEbitda
    const equityValue = ev - debt + (cash ?? 0)
    methods.push({
      key: 'ev',
      label: `EV/EBIT ${multiples.evEbitda}배`,
      value: equityValue,
      basis: '영업이익 × 배수 − 순차입금',
      detail: `${fmt(operating)} × ${multiples.evEbitda} − 차입금 ${fmt(debt)} + 현금 ${fmt(cash ?? 0)}`,
      note: '감가상각비를 원문에서 일관되게 뽑기 어려워 EBITDA 대신 영업이익(EBIT) 기준으로 계산했습니다. 실제 EBITDA 배수보다 보수적입니다.',
      adjustable: true,
    })
  }

  // 4) 최근 발행가 기준 — 투자자가 실제로 낸 값이다.
  const round = roundValue(rcps, shares)
  if (round) methods.push(round)

  // 원 단위 소수점은 의미가 없다.
  for (const m of methods) if (num(m.value) != null) m.value = Math.round(m.value)
  const usable = methods.filter((m) => num(m.value) != null)
  const range = usable.length
    ? { min: Math.min(...usable.map((m) => m.value)), max: Math.max(...usable.map((m) => m.value)) }
    : null
  const median = usable.length ? medianOf(usable.map((m) => m.value)) : null

  return {
    available: usable.length > 0,
    methods: usable,
    range,
    median,
    // 방법마다 분모가 다르다. 발행가 기준은 총 주식수로 매긴 값이라 보통주로 나누면
    // 발행가(17,500원)가 아닌 엉뚱한 값(20,500원)이 나온다.
    perShare: usable
      .map((m) => ({ key: m.key, label: m.label, value: m.perShare ?? (issued ? m.value / issued : null) }))
      .filter((x) => x.value != null),
    issuedShares: issued,
    shareCounts: {
      common: num(shares?.commonShares) ?? issued,
      preferred: num(shares?.preferredShares),
      total: num(shares?.totalShares),
      potential: num(shares?.potentialShares),
      diluted: num(shares?.dilutedShares),
    },
    inputs: { equity, netIncome, operating, assets, liabilities, cash, debt },
  }
}

/**
 * 상환전환우선주 발행가로 되짚은 기업가치 (post-money).
 *
 * 비상장사는 DART 에 투자 공시를 하지 않아 라운드 정보를 얻을 데가 여기뿐이다.
 * 장부가 기반 방법들이 실제 투자 단가와 크게 벌어지는 게 보통인데
 * (무하유: 순자산 108억 vs 발행가 기준 820억), 어느 쪽이 옳다기보다
 * '회계장부' 와 '투자자가 매긴 값' 이 원래 다른 것이다.
 *
 * 오래된 라운드일 수 있으므로 기준일을 반드시 함께 낸다.
 */
function roundValue(rcps, shares) {
  const price = num(rcps?.issuePrice)
  const total = num(shares?.totalShares)
  if (!price || !total) return null

  const year = rcps.issueDate ? rcps.issueDate.slice(0, 4) : null
  const diluted = num(shares?.dilutedShares)
  return {
    key: 'round',
    label: `발행가 기준${year ? ` (${year}년 라운드)` : ''}`,
    value: price * total,
    basis: '주당발행가액 × 총 발행주식수',
    detail:
      `${fmt(price)} × ${total.toLocaleString('ko-KR')}주` +
      (diluted && diluted !== total ? ` · 완전희석 ${diluted.toLocaleString('ko-KR')}주 기준 ${fmt(price * diluted)}` : ''),
    note:
      `${rcps.issueDate || '발행 시점'} 상환전환우선주 발행가로 되짚은 값입니다. ` +
      '투자자가 그 시점에 실제로 매긴 가격이라 장부가보다 크게 높은 것이 보통이지만, ' +
      '그 뒤 실적·시장 상황은 반영돼 있지 않습니다.',
    asOf: rcps.issueDate || null,
    issuePrice: price,
    // 이 방법의 1주당은 발행가 그 자체다.
    perShare: price,
  }
}

/**
 * 상속세및증여세법 제54조 보충적 평가방법.
 *   1주당 순손익가치 = 최근 3년 가중평균 순손익액 ÷ 10%
 *   1주당 순자산가치 = 순자산 ÷ 발행주식수
 *   일반법인 = (순손익가치 × 3 + 순자산가치 × 2) ÷ 5, 단 순자산가치의 80% 이상
 */
function inheritanceTaxValue(values, timelineRows, issued) {
  const equity = num(values?.totalEquity?.current)
  if (equity == null || !issued) return null

  // 최근 연도부터 3개년 순이익
  const byYearDesc = [...(timelineRows || [])].sort((a, b) => b.year - a.year)
  const profits = byYearDesc.map((r) => num(r.netIncome)).filter((v) => v != null).slice(0, 3)
  if (!profits.length) return null

  const usedWeights = WEIGHTS.slice(0, profits.length)
  const weightSum = usedWeights.reduce((a, b) => a + b, 0)
  const weighted = profits.reduce((sum, p, i) => sum + p * usedWeights[i], 0) / weightSum

  const perShareEarnings = weighted / issued / CAPITALIZATION_RATE
  const perShareAsset = equity / issued
  const blended = (perShareEarnings * 3 + perShareAsset * 2) / 5
  const floor = perShareAsset * 0.8
  const perShare = Math.max(blended, floor)

  return {
    key: 'statutory',
    label: '상증법 보충적 평가',
    value: perShare * issued,
    basis: '(순손익가치 × 3 + 순자산가치 × 2) ÷ 5',
    detail:
      `최근 ${profits.length}개년 가중평균 순손익 ${fmt(weighted)} ÷ 10% ÷ ${issued.toLocaleString('ko-KR')}주 = 1주당 순손익가치 ${fmt(perShareEarnings)}` +
      ` · 1주당 순자산가치 ${fmt(perShareAsset)}` +
      (blended < floor ? ' · 순자산가치의 80% 하한 적용' : ''),
    note:
      '비상장주식을 세법상 평가할 때 쓰는 법정 산식입니다(상속세및증여세법 제54조). ' +
      '부동산 과다보유 법인은 가중치가 2:3으로 달라지고, 최대주주 지분에는 할증이 붙습니다.',
    perShare,
    weightedProfit: weighted,
    years: profits.length,
  }
}

function medianOf(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}
