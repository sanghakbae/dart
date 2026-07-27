// DART 공시 목록의 연간/분기·반기 분류.
// 이 앱은 연 1회 감사받은 재무제표만 쓴다 — 상장사는 사업보고서, 비상장사는 감사보고서.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filingKind } from '../server/dart-handler.mjs'

test('상장사 사업보고서는 연간', () => {
  assert.equal(filingKind('사업보고서 (2025.12)'), 'annual')
})
test('비상장사 감사보고서·연결감사보고서는 연간', () => {
  assert.equal(filingKind('감사보고서'), 'annual')
  assert.equal(filingKind('[기재정정]연결감사보고서'), 'annual')
})
test('분기보고서는 quarter', () => {
  assert.equal(filingKind('분기보고서 (2025.03)'), 'quarter')
})
test('반기보고서는 half', () => {
  assert.equal(filingKind('반기보고서 (2025.06)'), 'half')
})
// '반기검토보고서' 에도 '검토보고서' 가 들어 있어, 반기·분기를 먼저 걸러야
// 연간으로 새지 않는다.
test('반기검토보고서가 연간으로 새지 않는다', () => {
  assert.equal(filingKind('반기검토보고서'), 'half')
  assert.equal(filingKind('분기검토보고서'), 'quarter')
})
