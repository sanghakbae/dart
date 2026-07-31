// DART 공시 목록의 연간/분기·반기 분류.
// 이 앱은 연 1회 감사받은 재무제표만 쓴다 — 상장사는 사업보고서, 비상장사는 감사보고서.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filingKind } from '../server/dart-handler.mjs'
import { filingPeriodKey, filingBasisCode } from '../src/lib/dart/filingKind.js'

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

// ── 이미 받아 둔 공시 잠그기 ──────────────────────────────
// 목록만 보고는 무엇을 받았는지 알 수 없어 같은 것을 또 눌러 보게 됐다.
// 저장된 보고서 ID(연도-기간종류-연결여부)와 맞추려면 공시 이름에서 앞부분을 뽑아야 한다.
test('기간 키 — 결산월로 기간종류를 가른다', () => {
  assert.equal(filingPeriodKey('감사보고서 (2025.12)'), '2025-FY')
  assert.equal(filingPeriodKey('사업보고서 (2025.12)'), '2025-FY')
  assert.equal(filingPeriodKey('반기보고서 (2025.06)'), '2025-H1')
  assert.equal(filingPeriodKey('분기보고서 (2025.09)'), '2025-Q3')
  assert.equal(filingPeriodKey('분기보고서 (2025.03)'), '2025-Q1')
})

test('기간 키 — 정정 말머리가 붙어도 같은 기간이다', () => {
  // 원본과 정정본은 같은 보고서다. 원본을 받아 뒀으면 정정본도 잠겨야 한다
  // (같은 ID 로 덮어쓰므로 새 보고서가 생기지 않는다).
  assert.equal(filingPeriodKey('[기재정정]사업보고서 (2015.12)'), '2015-FY')
  assert.equal(filingPeriodKey('[첨부정정]감사보고서 (2018.12)'), '2018-FY')
})

test('기간 키 — 연도를 못 찾으면 null (잠그지 않는다)', () => {
  assert.equal(filingPeriodKey('감사보고서'), null)
  assert.equal(filingPeriodKey(''), null)
})

test('기간 키 — 12·6·9·3 이 아닌 결산월은 이름으로 가른다', () => {
  assert.equal(filingPeriodKey('사업보고서 (2025.02)'), '2025-FY')
  assert.equal(filingPeriodKey('무슨보고서 (2025.02)'), null)
})

test('연결여부 — 이름에 연결이 있으면 c, 감사보고서는 s, 사업보고서는 모른다', () => {
  assert.equal(filingBasisCode('연결감사보고서 (2025.12)'), 'c')
  assert.equal(filingBasisCode('[기재정정]연결감사보고서'), 'c')
  assert.equal(filingBasisCode('감사보고서 (2025.12)'), 's')
  // 사업보고서는 연결·별도를 한 건에 함께 실어 어느 쪽으로 저장될지 모른다.
  assert.equal(filingBasisCode('사업보고서 (2025.12)'), null)
})

test('잠금 — 별도를 받아 뒀다고 연결까지 잠기지 않는다', () => {
  // 「감사보고서」와 「연결감사보고서」는 다른 문서다. 별도만 받은 상태에서
  // 연결까지 잠그면 연결을 영영 받을 수 없다.
  const have = new Set(['2025-FY-s'])
  const done = (nm) => {
    const k = filingPeriodKey(nm)
    const code = filingBasisCode(nm)
    return code ? have.has(`${k}-${code}`) : have.has(`${k}-s`) || have.has(`${k}-c`)
  }
  assert.equal(done('감사보고서 (2025.12)'), true)
  assert.equal(done('연결감사보고서 (2025.12)'), false)
  // 사업보고서는 어느 쪽이든 있으면 받은 것으로 본다.
  assert.equal(done('사업보고서 (2025.12)'), true)
  assert.equal(done('사업보고서 (2024.12)'), false)
})
