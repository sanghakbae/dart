// 주소로 화면 상태를 나르는 규칙.
// 주소는 사용자가 손으로 고칠 수 있으므로 이상한 입력에도 죽지 않아야 한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readRoute, writeRoute } from '../src/lib/route.js'

const TABS = ['summary', 'checklist', 'notes', 'raw']

test('회사·탭·보고서를 읽는다', () => {
  assert.deepEqual(readRoute('#/co/muhayu/checklist/2025-FY-s', TABS), {
    companyKey: 'muhayu',
    tab: 'checklist',
    reportId: '2025-FY-s',
  })
})

test('한글 회사키를 되돌린다', () => {
  const hash = writeRoute({ companyKey: '블룸에이아이', tab: 'checklist', reportId: '2025-FY-s' })
  assert.equal(hash, '#/co/%EB%B8%94%EB%A3%B8%EC%97%90%EC%9D%B4%EC%95%84%EC%9D%B4/checklist/2025-FY-s')
  assert.deepEqual(readRoute(hash, TABS), {
    companyKey: '블룸에이아이',
    tab: 'checklist',
    reportId: '2025-FY-s',
  })
})

test('탭·보고서는 없어도 된다', () => {
  assert.deepEqual(readRoute('#/co/muhayu', TABS), { companyKey: 'muhayu', tab: null, reportId: null })
})

test('모르는 탭은 무시한다 — 주소를 손으로 고쳤거나 탭 이름이 바뀐 뒤다', () => {
  assert.equal(readRoute('#/co/muhayu/없는탭', TABS).tab, null)
  assert.equal(readRoute('#/co/muhayu/__proto__', TABS).tab, null)
})

test('회사 화면이 아니면 빈 값', () => {
  for (const h of ['', '#', '#/', '#/admin', '#/co/', 'garbage']) {
    assert.equal(readRoute(h, TABS).companyKey, null, h)
  }
})

// decodeURIComponent 는 "%" 하나만 있어도 던진다. 주소창은 아무거나 들어올 수 있다.
test('깨진 인코딩에도 죽지 않는다', () => {
  assert.doesNotThrow(() => readRoute('#/co/%/summary', TABS))
  assert.doesNotThrow(() => readRoute('#/co/%E0%A4%A/summary', TABS))
  assert.equal(readRoute('#/co/%/summary', TABS).companyKey, '%')
})

test('회사가 없으면 목록 주소', () => {
  assert.equal(writeRoute({ companyKey: null, tab: 'notes' }), '#/')
})

test('탭이 없으면 요약으로 적는다', () => {
  assert.equal(writeRoute({ companyKey: 'a' }), '#/co/a/summary')
})

// 슬래시가 든 보고서 ID 가 들어와도 경로가 깨지면 안 된다.
test('보고서 ID 의 슬래시를 감싼다', () => {
  const hash = writeRoute({ companyKey: 'a', tab: 'raw', reportId: '2025/FY' })
  assert.deepEqual(readRoute(hash, TABS).reportId, '2025/FY')
})
