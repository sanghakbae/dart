// 사업보고서 연도·종류 오인식 회귀 테스트.
//
// 두산퓨얼셀 사업보고서(2025.12)가 '2024년 / 반기보고서' 로 뒤집혔다. 두 원인:
//  1) periodHints 에 핵심감사사항 서술이 섞여, "2024년 … 당기말 재고자산 …" 을
//     당기=2024 로 물었다.  → 제N기 뒤 날짜만 기간으로 인정하도록 고침.
//  2) guessDocKind 가 본문 전체를 훑어, 사업보고서 안의 "반기보고서 제출" 서술을
//     주웠다.  → 표지에 가장 먼저 나오는 종류를 택하도록 고침.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePeriods } from '../src/lib/parse/statements.js'
import { parseMeta } from '../src/lib/parse/meta.js'

test('기간 — 제N기 헤더로 당기 연도를 잡는다', () => {
  const blocks = [
    { periodHints: [
      '제 7 기 2025.12.31 현재',
      '제 6 기 2024.12.31 현재',
      '제 7 기 2025.01.01 부터 2025.12.31 까지',
    ] },
  ]
  const [cur, prior] = resolvePeriods(blocks, { fiscalYear: 2025, termNo: 7 })
  assert.equal(cur.year, 2025)
  assert.equal(prior.year, 2024)
  assert.equal(cur.source, 'statement')
})

test('기간 — 핵심감사사항 서술의 연도·당기에 속지 않는다', () => {
  const blocks = [
    { periodHints: [
      // 진짜 헤더
      '제 7 기 2025.01.01 부터 2025.12.31 까지',
      '제 6 기 2024.01.01 부터 2024.12.31 까지',
      // 서술 문단: 여기 "2024년 … 당기말" 이 예전엔 당기=2024 로 잡혔다
      '2024년 12월 31일 현재 회사의 재고자산 장부가액은 379,265백만원으로 당기말 현재 자산총계의 32%입니다.',
    ] },
  ]
  const [cur] = resolvePeriods(blocks, { fiscalYear: 2025, termNo: 7 })
  assert.equal(cur.year, 2025)
})

test('기간 — 당기/전기 라벨만 있는 옛 서식도 읽는다', () => {
  const blocks = [{ periodHints: ['당기 2023.01.01 부터 2023.12.31', '전기 2022.01.01 부터 2022.12.31'] }]
  const [cur, prior] = resolvePeriods(blocks, { fiscalYear: null })
  assert.equal(cur.year, 2023)
  assert.equal(prior.year, 2022)
})

test('기간 — 헤더가 없으면 표지 연도로 떨어진다', () => {
  const [cur, prior] = resolvePeriods([{ periodHints: [] }], { fiscalYear: 2022 })
  assert.equal(cur.year, 2022)
  assert.equal(prior.year, 2021)
  assert.equal(cur.source, 'meta')
})

test('종류 — 사업보고서 본문의 반기보고서 언급에 속지 않는다', () => {
  const doc = {
    fullText:
      '사업보고서\n제 7 기 사업연도\n두산퓨얼셀 주식회사\n' +
      '... 당사는 분기보고서 및 반기보고서를 각 분기·반기 종료 후 45일 이내에 제출합니다 ...',
  }
  assert.equal(parseMeta(doc).docKind, '사업보고서')
})

test('종류 — 분기보고서는 분기보고서로', () => {
  assert.equal(parseMeta({ fullText: '분기보고서\n제 7 기 1분기\n두산퓨얼셀' }).docKind, '분기보고서')
})
