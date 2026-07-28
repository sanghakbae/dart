// 상장사 사업보고서 읽기.
//
// 사업보고서에는 감사보고서 전문이 없다(첨부로 따로 붙는다). 대신 「V. 회계감사인의
// 감사의견 등」에 요약 표로 실린다. 그걸 못 읽어 SK하이닉스가 '판정 불가' 로 떴다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNarrative } from '../src/lib/parse/opinion.js'
import { parseStatements } from '../src/lib/parse/statements.js'

const docOf = (text) => ({
  fullText: text,
  rows: text.trim().split('\n').map((line) => ({
    text: line,
    cells: line.split('\t').map((c) => c.trim()),
  })),
})

// 목차에도 같은 제목이 있다. 거기 걸리면 본문 대신 목차를 잘라 온다.
const TOC = `
IV. 이사의 경영진단 및 분석의견
V. 회계감사인의 감사의견 등
1. 외부감사에 관한 사항
VI. 이사회 등 회사의 기관에 관한 사항
`

const SUMMARY = `
V. 회계감사인의 감사의견 등
1. 외부감사에 관한 사항
가. 회계감사인의 명칭 및 감사의견
사업연도 구분 감사인 감사의견 의견변형사유
제78기(당기) 감사보고서 삼정회계법인 적정의견 해당사항 없음
연결감사보고서 삼정회계법인 적정의견 해당사항 없음
제77기(전기) 감사보고서 삼정회계법인 한정의견 해당사항 없음
제76기(전전기) 감사보고서 삼정회계법인 의견거절 해당사항 없음
`

test('사업보고서 — 요약 표에서 당기 감사의견을 읽는다', () => {
  const n = parseNarrative(docOf(TOC + SUMMARY))
  assert.equal(n.opinion.type, 'unqualified')
  assert.equal(n.opinion.label, '적정의견')
})

// 전기까지 훑으면 옛 의견(한정·거절)을 물어 온다.
test('사업보고서 — 전기 의견에 물들지 않는다', () => {
  const flipped = SUMMARY.replace('제78기(당기) 감사보고서 삼정회계법인 적정의견', '제78기(당기) 감사보고서 삼정회계법인 한정의견')
  const n = parseNarrative(docOf(TOC + flipped))
  assert.equal(n.opinion.type, 'qualified')
})

test('사업보고서 — 목차만 있으면 판정하지 않는다', () => {
  const n = parseNarrative(docOf(TOC))
  assert.equal(n.opinion.type, 'unknown')
})

// 감사보고서 원문은 예전대로 본문에서 읽어야 한다.
test('감사보고서 원문 — 본문 문장으로 판정한다', () => {
  const body = `
독립된 감사인의 감사보고서
주식회사 무하유 주주 및 이사회 귀중
감사의견
우리는 별첨된 재무제표를 감사하였습니다. 우리의 의견으로는 회사의 재무제표는 중요성의 관점에서 공정하게 표시하고 있습니다.
`
  const n = parseNarrative(docOf(body))
  assert.equal(n.opinion.type, 'unqualified')
})

// 사업보고서에는 연결과 별도가 나란히 실린다. 계정 수로 겨루면 해마다 뒤집힌다.
test('연결·별도가 함께 실리면 연결을 주재무제표로 본다', () => {
  const doc = docOf(`
연결 재무상태표
제 78 기 2025.12.31 현재
과 목\t제 78 기\t제 77 기
자산총계\t120,000,000\t100,000,000
부채총계\t50,000,000\t40,000,000
자본총계\t70,000,000\t60,000,000
재무상태표
제 78 기 2025.12.31 현재
과 목\t제 78 기\t제 77 기
자산총계\t110,000,000\t95,000,000
부채총계\t45,000,000\t38,000,000
자본총계\t65,000,000\t57,000,000
현금및현금성자산\t9,000,000\t8,000,000
`)
  assert.equal(parseStatements(doc, { fiscalYear: 2025 }).basis, '연결')
})

test('별도만 있으면 별도다', () => {
  const doc = docOf(`
재무상태표
제 15 기 2025.12.31 현재
과 목\t제 15 기\t제 14 기
자산총계\t34,188,231,721\t30,344,985,559
부채총계\t23,343,055,283\t20,558,387,713
자본총계\t10,845,176,438\t9,786,597,846
`)
  assert.equal(parseStatements(doc, { fiscalYear: 2025 }).basis, '별도')
})

// 상호는 한 낱말이다. 앞을 [^\n]{0,18} 로 열어 두었더니 공백·숫자까지 삼켜
// SK하이닉스 감사인이 "제품 2026-01-01 삼정회계법인" 으로 잡혔다.
test('감사인 — 앞 단어를 끌고 오지 않는다', async () => {
  const { parseMeta } = await import('../src/lib/parse/meta.js')
  const doc = docOf(
    '사업보고서\n제 78 기\n제품 2026-01-01 삼정회계법인 적정의견\n'
  )
  assert.equal(parseMeta(doc).auditor, '삼정회계법인')
})

test('감사인 — 여러 서식을 읽는다', async () => {
  const { parseMeta } = await import('../src/lib/parse/meta.js')
  const of = (line) => parseMeta(docOf(`감사보고서\n${line}\n`)).auditor
  assert.equal(of('한영회계법인'), '한영회계법인')
  assert.equal(of('회계법인 마일스톤'), '회계법인 마일스톤')
  assert.equal(of('대주회계법인 대표이사 홍길동'), '대주회계법인')
})
