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
