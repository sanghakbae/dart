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

// mapFilings 는 내부에서 filingKind 를 부른다. 재수출만 해 두면 이 함수 안에서
// 이름을 못 찾아 런타임에 "filingKind is not defined" 로 터진다(배포본에서 겪음).
// 네트워크 없이 그 경로를 그대로 밟아 확인한다.
import { mapFilings } from '../server/dart-handler.mjs'

test('mapFilings — 감사보고서류만 남기고 kind 를 붙인다', () => {
  const rows = [
    { rcept_no: '1', report_nm: '사업보고서 (2025.12)', rcept_dt: '20260318', corp_name: '두산퓨얼셀' },
    { rcept_no: '2', report_nm: '분기보고서 (2026.03)', rcept_dt: '20260515' },
    { rcept_no: '3', report_nm: '최대주주등소유주식변동신고서', rcept_dt: '20260101' }, // 감사류 아님 → 제외
    { rcept_no: '2', report_nm: '분기보고서 (2026.03)', rcept_dt: '20260515' }, // 중복
  ]
  const list = mapFilings(rows)
  assert.equal(list.length, 2) // 신고서 제외 + 중복 제거
  assert.equal(list[0].reportNm, '분기보고서 (2026.03)') // 최신순
  assert.equal(list.find((f) => f.rceptNo === '1').kind, 'annual')
  assert.equal(list.find((f) => f.rceptNo === '2').kind, 'quarter')
})

test('mapFilings — 빈 입력도 안전', () => {
  assert.deepEqual(mapFilings(), [])
})
