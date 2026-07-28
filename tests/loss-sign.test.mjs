// 적자를 적는 두 가지 서식.
//   ① 「영업손실  4,118,907,794」   — 라벨이 손실, 숫자는 양수
//   ② 「영업이익 (4,118,907,794)」  — 라벨이 이익, 숫자는 음수
// ②만 맞고 ①은 양수 그대로 들어가, 블룸에이아이 영업손실 41.2억이
// 영업이익 41.2억으로 떴다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchAccount } from '../src/lib/parse/taxonomy.js'
import { parseStatements } from '../src/lib/parse/statements.js'

// extract 단계가 만드는 행 모양(text + cells)을 그대로 흉내 낸다.
const docOf = (text) => ({
  fullText: text,
  rows: text.trim().split('\n').map((line) => ({
    text: line,
    cells: line.split('\t').map((c) => c.trim()),
  })),
})

test('라벨이 손실이면 부호를 뒤집으라고 알린다', () => {
  assert.equal(matchAccount('Ⅲ. 영업손실', 'IS').negate, true)
  assert.equal(matchAccount('당기순손실', 'IS').negate, true)
  assert.equal(matchAccount('법인세비용차감전순손실', 'IS').negate, true)
})

test('괄호 병기 (손실) 는 서식일 뿐 손실 확정이 아니다', () => {
  assert.equal(matchAccount('영업이익(손실)', 'IS').negate, undefined)
  assert.equal(matchAccount('당기순이익(손실)', 'IS').negate, undefined)
  assert.equal(matchAccount('영업이익', 'IS').negate, undefined)
})

// ① 손실 라벨 + 양수 — 블룸에이아이 제10기 실제 값
test('손실 라벨에 양수가 오면 음수로 읽는다', () => {
  const doc = docOf(`
손 익 계 산 서
제 10 기 2025.01.01 부터 2025.12.31 까지
과 목\t제 10 기\t제 9 기
Ⅰ. 매출액\t32,148,376,982\t15,120,000,000
Ⅲ. 영업손실\t4,118,907,794\t3,244,654,243
Ⅷ. 당기순손실\t4,547,444,999\t4,080,000,000
`)
  const st = parseStatements(doc, { fiscalYear: 2025 })
  assert.equal(st.values.revenue.current, 32_148_376_982)
  assert.equal(st.values.operatingProfit.current, -4_118_907_794)
  assert.equal(st.values.netIncome.current, -4_547_444_999)
  // 전기도 같이 뒤집힌다
  assert.equal(st.values.operatingProfit.prior, -3_244_654_243)
})

// ② 이익 라벨 + 음수(괄호) — 이미 맞던 쪽이 망가지지 않았는지
test('이익 라벨에 괄호 음수가 오면 그대로 둔다', () => {
  const doc = docOf(`
손 익 계 산 서
제 10 기 2025.01.01 부터 2025.12.31 까지
과 목\t제 10 기\t제 9 기
Ⅰ. 매출액\t32,148,376,982\t15,120,000,000
Ⅲ. 영업이익(손실)\t(4,118,907,794)\t(3,244,654,243)
`)
  const st = parseStatements(doc, { fiscalYear: 2025 })
  assert.equal(st.values.operatingProfit.current, -4_118_907_794)
})

test('흑자는 건드리지 않는다', () => {
  const doc = docOf(`
손 익 계 산 서
제 15 기 2025.01.01 부터 2025.12.31 까지
과 목\t제 15 기\t제 14 기
Ⅰ. 매출액\t12,724,002,881\t11,064,018,372
Ⅲ. 영업이익(손실)\t2,199,060,934\t(473,581,605)
`)
  const st = parseStatements(doc, { fiscalYear: 2025 })
  assert.equal(st.values.operatingProfit.current, 2_199_060_934)
  assert.equal(st.values.operatingProfit.prior, -473_581_605)
})

// 결손금은 '음수 자본' 이 아니라 계정 이름이다. 잘못 뒤집으면 자본총계가 어긋난다.
test('이익잉여금(결손금) 라벨은 뒤집지 않는다', () => {
  assert.equal(matchAccount('이익잉여금(결손금)', 'BS').negate, undefined)
})
