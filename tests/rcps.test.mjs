// 상환전환우선주·자본금 주석 파서.
// 무하유 제15기 연결감사보고서의 실제 표를 그대로 옮겨 왔다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRcps, redemptionAt } from '../src/lib/parse/rcps.js'
import { parseCapital } from '../src/lib/parse/capital.js'

/** 탭으로 나뉜 표 텍스트를 doc.rows 모양으로 바꾼다. */
const docOf = (text) => ({
  rows: text.trim().split('\n').map((line) => ({ cells: line.split('\t').map((c) => c.trim()) })),
})

const RCPS_NOTE = `
14. 상환전환우선주
(1) 보고기간말 현재 상환전환우선주부채의 내역은 다음과 같습니다.
(단위: 원)
구 분\t당기말\t전기말\t전기초
상환전환우선주\t12,001,000,000\t12,001,000,000\t12,001,000,000
상환할증금\t11,606,783,439\t11,606,783,439\t11,606,783,439
전환권조정\t(16,945,806,384)\t(17,944,540,152)\t(18,793,548,249)
소 계\t6,661,977,055\t5,663,243,287\t4,814,235,190
차감: 유동성대체\t(6,661,977,055)\t(5,663,243,287)\t(4,814,235,190)
합 계\t-\t-\t-
(2) 연결회사가 발행한 상환전환우선주의 세부내역은 다음과 같습니다.
구 분\t제1종 상환전환우선주
대상자\t각 투자자
주당발행가액(*1)\t17,500원
발행주식수(*2)\t685,800주
발행일\t2023-10-21
의결권\t1주당 1개의 의결권
존속기간\t발행일로부터 10년(존속기간 이후 자동으로 보통주로 전환)
배당\t액면가액 기준 0% 누적적/참가적 우선주
전환청구자\t본건 종류주식의 주주
전환비율\t본건 종류주식의 1주당 보통주 1주
전환비율의 조정\t회사의 IPO 공모단가의 70%에 해당하는 금액이 그 당시의 본건종류주식의 전환가액을 하회하는 경우, 본건 종류주식의 전환가액을 회사의 IPO 공모단가의 70%에 해당하는 금액으로 조정한다.
전환청구 기간\t발행일로부터 10년이 경과하는 날의 전일
상환청구권 보유자\t본건 종류주식의 주주
상환청구 기간\t발행일로부터 3년이 경과한 날부터 존속기간 만료일까지
상환금액\t본건 종류주식의 1주당 발행가액에 대하여 본건 종류주식의 효력발생일로부터 상환일까지연복리 7%의 비율로 계산한 이자에서 이미 지급된 배당금을 차감한 금액
(3) 당기와 전기 중 상환전환우선주부채의 변동내역은 다음과 같습니다.
구 분\t당기\t전 기
기초\t5,663,243,287\t4,814,235,190
상각\t998,733,768\t849,008,097
기말\t6,661,977,055\t5,663,243,287
연결회사는 상환전환우선주 발행으로 수령한 순수취액을 주계약 부채요소와 내재파생상품 전환권 및 조기상환권으로 구분하여 계상하였습니다. 주계약 부채요소는 상환전환우선주부채로 계상되어 있으며, 전환권 및 조기상환권은 파생상품부채로 계상되어있습니다.
(4) 보고기간말 현재 상환전환우선주 관련하여 인식된 재무상태표에 인식된 금액은 다음과 같습니다.
구 분\t당기말\t전기말\t전기초\t최초인식시장부금액
전환권파생상품부채\t\t\t\t
2023년 발행 상환전환우선주\t10,180,300,675\t9,191,232,490\t7,534,331,942\t7,345,008,173
(5) 당기와 전기 중 상환전환우선주 관련 손익은 다음과 같습니다.
구 분\t당기\t전기
법인세비용차감전순이익(손실)\t874,528,673\t(2,252,459,243)
파생금융상품평가손실\t989,068,185\t1,656,900,548
파생금융상품평가손익 제외법인세비용차감전순이익(손실)\t1,863,596,858\t(595,558,695)
15. 퇴직급여
15.1 확정기여제도
당기 중 확정기여제도와 관련해 비용으로 인식한 금액은 726,967,397원입니다.
`

const CAPITAL_NOTE = `
18. 자본금과 주식발행초과금
(1) 보고기간말 현재 연결회사의 자본금의 내용은 다음과 같습니다.
(단위: 원)
구 분\t당기말\t전기말\t전기초
수권주식수\t50,000,000주\t80,000주\t80,000주
발행주식수\t4,000,000주\t20,000주\t20,000주
1주당 금액\t500\t5,000\t5,000
보통주 자본금\t2,000,000,000\t100,000,000\t100,000,000
(2) 보고기간말 현재 주식발행초과금은 없습니다.
(3) 당기와 전기 중 자본금의 변동 내용은 다음과 같습니다.
구 분\t주식수\t보통주 자본금
전기초\t20,000주\t100,000,000
전기말\t20,000주\t100,000,000
무상증자(*1)\t380,000주\t1,900,000,000
액면분할(*1)\t3,600,000주\t-
당기말\t4,000,000주\t2,000,000,000
19. 주식기준보상
(1) 보고기간말 현재 부여한 주식선택권의 주요사항은 다음과 같습니다.
구 분\t발행주식수\t행사가능주식수\t부여일\t부여방법\t행사가격\t행사가능기간
1차(*)\t73,800주\t73,800주\t2024-03-22\t신주교부방식\t4,600\t2026-03-23 ~ 2033-03-23
2차\t60,000주\t60,000주\t2025-10-31\t신주교부방식\t5,000\t2027-11-01 ~ 2034-10-31
20. 기타자본항목
`

test('RCPS — 부채 내역', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  assert.equal(r.liability.face, 12_001_000_000)
  assert.equal(r.liability.premium, 11_606_783_439)
  assert.equal(r.liability.conversionAdj, -16_945_806_384)
  assert.equal(r.liability.carrying, 6_661_977_055)
  // 전액 유동성대체 = 1년 안에 상환청구가 열려 있다
  assert.equal(r.liability.allCurrent, true)
})

test('RCPS — 세부내역', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  assert.equal(r.series.length, 1)
  assert.equal(r.series[0].name, '제1종 상환전환우선주')
  assert.equal(r.shares, 685_800)
  assert.equal(r.issuePrice, 17_500)
  assert.equal(r.issueDate, '2023-10-21')
})

test('RCPS — 조항에서 기간과 이율을 읽는다', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  assert.equal(r.termYears, 10)
  assert.equal(r.maturityDate, '2033-10-21')
  assert.equal(r.putAfterYears, 3)
  assert.equal(r.putStartDate, '2026-10-21')
  assert.equal(r.statedRate, 7)
})

test('RCPS — 상환할증금으로 역산한 이율이 조항과 맞는다', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  // (12,001 + 11,607) ÷ 12,001 의 10제곱근 − 1 = 7.00%
  assert.equal(r.impliedRate, 7)
})

test('RCPS — 상각액이 곧 당기 이자비용', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  assert.equal(r.accretion.current, 998_733_768)
  assert.equal(r.accretion.prior, 849_008_097)
})

test('RCPS — 파생상품부채까지 합쳐야 실제 부담이 보인다', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  assert.equal(r.derivative.current, 10_180_300_675)
  // 부채요소 66.6억 + 파생 101.8억 = 168.4억 (자본총계 108.5억보다 크다)
  assert.equal(r.totalLiability, 16_842_277_730)
})

test('RCPS — 파생평가손익을 뺀 이익을 회사가 밝힌 그대로 가져온다', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  assert.equal(r.pnl.pretax, 874_528_673)
  assert.equal(r.pnl.derivativeLoss, 989_068_185)
  assert.equal(r.pnl.pretaxExDerivative, 1_863_596_858)
})

test('RCPS — 상환청구 시점 상환금액', () => {
  const r = parseRcps(docOf(RCPS_NOTE))
  // 원금 × 1.07³ = 147.0억
  assert.equal(redemptionAt(r, 3), 14_701_741_043)
})

// 재무상태표의 항목 행이 주석 제목으로 잡혀, 주석은 손도 못 대고
// 부채 행 두 줄만 잘라 온 적이 있다. 제목 앞에 그 행을 그대로 놓고 확인한다.
test('RCPS — 재무상태표의 「1. 상환전환우선주부채」 행에 속지 않는다', () => {
  const BALANCE = [
    'Ⅰ. 유동부채\t\t22,413,716,544',
    '1. 상환전환우선주부채\t4,5,6\t6,661,977,055\t5,663,243,287\t4,814,235,190',
    '2. 파생상품부채\t4,5,6\t10,180,300,675\t9,191,232,490\t7,534,331,942',
    '3. 계약부채\t13,22\t4,301,284,596\t3,432,580,828\t2,990,030,687',
    '2.15 상환전환우선주',
    '연결회사가 발행한 복합금융상품은 상환전환우선주입니다.',
  ].join('\n')

  const r = parseRcps(docOf(`${BALANCE}\n${RCPS_NOTE.trim()}`))
  assert.equal(r.shares, 685_800)
  assert.equal(r.issuePrice, 17_500)
  assert.equal(r.liability.face, 12_001_000_000)
})

test('RCPS — 주석이 없으면 null', () => {
  assert.equal(parseRcps(docOf(CAPITAL_NOTE)), null)
})

test('자본금 — 보통주만 잡힌다', () => {
  const c = parseCapital(docOf(CAPITAL_NOTE))
  assert.equal(c.authorizedShares, 50_000_000)
  assert.equal(c.issuedShares, 4_000_000)
  assert.equal(c.parValue, 500)
  assert.equal(c.capitalStock, 2_000_000_000)
})

test('자본금 — 무상증자와 액면분할을 가른다', () => {
  const c = parseCapital(docOf(CAPITAL_NOTE))
  assert.deepEqual(
    c.changes.map((x) => [x.kind, x.shares, x.capitalMoved]),
    [
      ['bonus', 380_000, true], // 잉여금 자본전입 → 자본금이 함께 늘었다
      ['split', 3_600_000, false], // 액면만 쪼갬 → 자본금 그대로
    ]
  )
})

test('자본금 — 잔액 행은 사건이 아니다', () => {
  const c = parseCapital(docOf(CAPITAL_NOTE))
  assert.equal(c.changes.some((x) => /기초|기말/.test(x.label)), false)
})

test('주식선택권 — 완전희석에 들어갈 잠재주식', () => {
  const c = parseCapital(docOf(CAPITAL_NOTE))
  assert.equal(c.stockOptions.potentialShares, 133_800)
  assert.equal(c.stockOptions.grants.length, 2)
  assert.equal(c.stockOptions.grants[0].strike, 4_600)
})

// ── 종류가 여럿일 때 ──────────────────────────────────────────
// 제1종·제2종을 다른 가격에 발행하는 일이 흔하다. 첫 종류의 가격을 대표로 쓰면
// 기업가치가 통째로 틀어진다.
const TWO_SERIES = `
9. 상환전환우선주
(2) 당사가 발행한 상환전환우선주의 세부내역은 다음과 같습니다.
구 분\t제1종 상환전환우선주\t제2종 상환전환우선주
주당발행가액\t10,000원\t25,000원
발행주식수\t100,000주\t40,000주
발행일\t2021-05-20\t2024-03-11
존속기간\t발행일로부터 10년\t발행일로부터 7년
상환청구 기간\t발행일로부터 3년이 경과한 날부터\t발행일로부터 5년이 경과한 날부터
상환금액\t연복리 5%의 비율로 계산한 이자\t연복리 5%의 비율로 계산한 이자
10. 퇴직급여
`

test('RCPS — 대표 단가는 가장 최근 라운드 것을 쓴다', () => {
  const r = parseRcps(docOf(TWO_SERIES))
  assert.equal(r.series.length, 2)
  assert.equal(r.shares, 140_000)
  assert.equal(r.issuePrice, 25_000) // 2024년 라운드
  assert.equal(r.issueDate, '2024-03-11')
  assert.equal(r.mixedPrices, true)
})

test('RCPS — 조달금액은 종류별로 곱해 더한다', () => {
  const r = parseRcps(docOf(TWO_SERIES))
  // 10,000 × 100,000 + 25,000 × 40,000 = 20억. 대표 단가로 곱하면 35억이 된다.
  assert.equal(r.raised, 2_000_000_000)
})

test('RCPS — 상환청구는 가장 먼저 열리는 것이 위험을 정한다', () => {
  const r = parseRcps(docOf(TWO_SERIES))
  // 제1종 2021+3=2024, 제2종 2024+5=2029 → 이른 쪽
  assert.equal(r.putStartDate, '2024-05-20')
})

test('RCPS — 종류가 둘이면 상환할증금 역산을 하지 않는다', () => {
  const r = parseRcps(docOf(TWO_SERIES))
  // 부채 표의 원금은 종류를 합친 값이라 한 종류의 존속기간으로 나눌 수 없다
  assert.equal(r.impliedRate, null)
})

test('자본금 — 열 순서가 뒤바뀌어도 주식수와 자본금을 헷갈리지 않는다', () => {
  const SWAPPED = `
12. 자본금
(3) 당기 중 자본금의 변동 내용은 다음과 같습니다.
구 분\t자본금\t주식수
액면분할\t-\t3,600,000주
무상증자\t1,900,000,000\t380,000주
13. 이익잉여금
`
  const c = parseCapital(docOf(SWAPPED))
  assert.deepEqual(
    c.changes.map((x) => [x.kind, x.shares, x.capital]),
    [
      ['split', 3_600_000, null],
      ['bonus', 380_000, 1_900_000_000],
    ]
  )
})

// 보통주를 못 읽었는데 우선주만 잡히면, 그 수가 총 발행주식수로 앉아
// 기업가치가 통째로 그 수로 매겨진다. 총수를 지어내지 않는지 본다.
test('주식수 — 보통주를 모르면 총 발행주식수를 만들지 않는다', async () => {
  const { parseShares } = await import('../src/lib/parse/shares.js')
  const doc = { fullText: '상환전환우선주를 발행하였습니다.', rows: [] }
  const s = parseShares(doc, null, { rcps: { shares: 685_800 }, capital: null })
  assert.equal(s.commonShares, null)
  assert.equal(s.preferredShares, 685_800)
  assert.equal(s.totalShares, null)
  assert.equal(s.dilutedShares, null)
})

// 무하유 2024년 보고서는 총주식수 기준 58.00%, 2025년은 보통주 기준 67.94% 로 적었다.
// 지분은 1주도 안 움직였는데 두 해를 나란히 놓으면 늘어난 것처럼 보였다.
test('최대주주 — 분모가 보고서마다 달라도 두 기준을 모두 낸다', async () => {
  const { parseShares } = await import('../src/lib/parse/shares.js')
  const doc = {
    fullText: '당기말 현재 최대 주주(보통주)이자 대표이사인 신동호는 2,717,600주(지분율 67.94%)의 주식을 보유하고 있습니다.',
    rows: [],
  }
  const s = parseShares(doc, null, {
    rcps: { shares: 685_800 },
    capital: { issuedShares: 4_000_000 },
  })
  const m = s.majorShareholder
  assert.equal(m.shares, 2_717_600)
  assert.equal(m.statedBasis, 'common') // 문장은 보통주 기준으로 적혔다
  assert.equal(Math.round(m.ratioCommon * 100) / 100, 67.94)
  assert.equal(Math.round(m.ratioTotal * 100) / 100, 58) // 2024년 보고서가 적은 값과 같다
})

// 주식선택권은 자본금과 다른 주석에 있다. 자본금 주석이 없다고 잠재주식까지
// 버리면 완전희석 주식수가 조용히 사라진다.
test('자본금 — 자본금 주석이 없어도 주식선택권은 살린다', () => {
  const ONLY_OPTIONS = `
19. 주식기준보상
구 분\t발행주식수\t행사가능주식수\t부여일\t부여방법\t행사가격\t행사가능기간
1차\t73,800주\t73,800주\t2024-03-22\t신주교부방식\t4,600\t2026-03-23 ~ 2033-03-23
20. 기타자본항목
`
  const c = parseCapital(docOf(ONLY_OPTIONS))
  assert.equal(c.issuedShares, undefined)
  assert.equal(c.stockOptions.potentialShares, 73_800)
})

// 일반기업회계기준 보고서는 우선주를 발행주식수에 이미 포함해 적는다
// (무하유 2024년 23,429주 = 보통주 20,000 + RCPS 3,429). 그걸 쪼갤 근거가
// 문서에 없으므로 '보통주 기준' 이라고 단정하면 안 된다.
test('최대주주 — 우선주를 못 가려내면 기준을 단정하지 않는다', async () => {
  const { parseShares } = await import('../src/lib/parse/shares.js')
  const doc = {
    fullText: '당기말 현재 최대 주주이자 대표이사인 신동호는 13,588주(지분율 58.00%)의 주식을 보유하고 있습니다.',
    rows: [],
  }
  const s = parseShares(doc, null, { rcps: null, capital: { issuedShares: 23_429 } })
  assert.equal(s.majorShareholder.statedBasis, null)
  assert.equal(s.preferredShares, null)
})

// ── 고용 KPI ─────────────────────────────────────────────────
// 기간을 바꿔도 KPI 가 그대로면 무엇을 보고 있는지 알 수 없다.
const MONTHS = Array.from({ length: 24 }, (_, i) => ({
  ym: `20${24 + Math.floor((6 + i) / 12)}-${String(((6 + i) % 12) + 1).padStart(2, '0')}`,
  headcount: 100 + i,
  joined: 2,
  left: 1,
  avgMonthlyWage: 4_000_000 + i * 10_000,
}))

test('고용 — 기간 합계와 평균이 고른 개월 수를 따른다', async () => {
  const { periodSummary } = await import('../src/lib/nps/stats.js')
  const one = periodSummary(MONTHS.slice(-12))
  const two = periodSummary(MONTHS)
  assert.equal(one.months, 12)
  assert.equal(one.joined, 24)
  assert.equal(two.months, 24)
  assert.equal(two.joined, 48)
  assert.notEqual(one.avgMonthlyWage, two.avgMonthlyWage)
})

test('고용 — 퇴사율은 기간이 달라도 연율로 견줄 수 있다', async () => {
  const { turnoverRate } = await import('../src/lib/nps/stats.js')
  const one = turnoverRate(MONTHS.slice(-12))
  const two = turnoverRate(MONTHS)
  // 매달 같은 비율로 나가므로 연율은 거의 같아야 한다(인원이 늘어 소폭 낮아진다)
  assert.ok(Math.abs(one.rate - two.rate) < 3, `${one.rate} vs ${two.rate}`)
  assert.equal(two.months, 24)
})

test('고용 — 12개월이면 예전 산식과 같은 값', async () => {
  const { turnoverRate } = await import('../src/lib/nps/stats.js')
  const flat = Array.from({ length: 12 }, (_, i) => ({ ym: `2025-${String(i + 1).padStart(2, '0')}`, headcount: 100, left: 2 }))
  // 24명 ÷ 100명 = 24.0%
  assert.equal(turnoverRate(flat).rate, 24)
})
