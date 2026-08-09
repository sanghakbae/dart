// 주석에서 특수관계자 거래·우발상황을 꺼내는 규칙.
//
// 이 화면의 숫자는 투자 판단에 바로 쓰이므로, 틀린 값을 내느니 안 내는 쪽으로 만들었다.
// 아래 테스트는 그 '안 내는' 경계를 지킨다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractRelatedParty, extractContingencies, cellAmount, unitScaleOf,
} from '../src/lib/analyze/related.js'

const note = (o) => ({ items: [{ no: 30, title: '특수관계자 등', body: '', content: [], ...o }] })

test('금액 셀 — 괄호는 음수, 빈 칸과 대시는 없는 값', () => {
  assert.equal(cellAmount('1,234'), 1234)
  assert.equal(cellAmount('(1,234)'), -1234)
  assert.equal(cellAmount('-'), null)
  assert.equal(cellAmount(''), null)
  assert.equal(cellAmount('카피모니터㈜'), null)
})

test('단위 표기를 읽는다', () => {
  assert.equal(unitScaleOf('(단위:천원)'), 1000)
  assert.equal(unitScaleOf('(단위: 백만원)'), 1_000_000)
  assert.equal(unitScaleOf('(단위 : 원)'), 1)
  assert.equal(unitScaleOf('표에 단위 표기가 없다'), null)
})

test('천원 단위 표를 원으로 환산한다', () => {
  // 환산하지 않으면 비중이 1000배 어긋난다 — 실제로 0.1% 로 나온 회사가 있었다.
  const n = note({
    content: [
      { type: 'p', text: '(단위:천원)' },
      { type: 'table', header: ['구분', '매출'], rows: [['관계사', '100,000']] },
    ],
  })
  const r = extractRelatedParty(n, 1_000_000_000)
  assert.equal(r.revenueFromRelated, 100_000_000) // 100,000천원 = 1억
  assert.equal(Math.round(r.share), 10)
})

test('단위를 못 찾은 표는 아예 더하지 않는다', () => {
  const n = note({
    content: [{ type: 'table', header: ['구분', '매출'], rows: [['관계사', '100,000']] }],
  })
  const r = extractRelatedParty(n, 1_000_000_000)
  assert.equal(r.revenueFromRelated, null)
  assert.equal(r.share, null)
})

test('매입 열은 매출로 세지 않는다', () => {
  const n = note({
    content: [
      { type: 'p', text: '(단위 : 원)' },
      {
        type: 'table',
        header: ['구분', '제품 매출', '상표권매입'],
        rows: [['관계사', '500', '9,999']],
      },
    ],
  })
  const r = extractRelatedParty(n, 1000)
  assert.equal(r.revenueFromRelated, 500)
  assert.equal(r.method, 'column')
})

test('열 제목이 없으면 행 이름으로 찾는다 — 채권 잔액 표는 건너뛴다', () => {
  const n = note({
    content: [
      { type: 'p', text: '(단위 : 원)' },
      { type: 'table', header: ['구 분', '당기', '전기'], rows: [['매출', '700', '600']] },
      { type: 'p', text: '(단위 : 원)' },
      { type: 'table', header: ['구 분', '당기말', '전기말'], rows: [['매출채권', '5,000', '4,000']] },
    ],
  })
  const r = extractRelatedParty(n, 1000)
  assert.equal(r.method, 'row')
  assert.equal(r.revenueFromRelated, 700) // 채권 5,000 은 빠진다
})

test('비중이 20% 이상이면 확인 대상으로 표시한다', () => {
  const mk = (amt) =>
    extractRelatedParty(
      note({
        content: [
          { type: 'p', text: '(단위 : 원)' },
          { type: 'table', header: ['구분', '매출'], rows: [['관계사', amt]] },
        ],
      }),
      1000
    )
  assert.equal(mk('100').heavy, false)
  assert.equal(mk('250').heavy, true)
})

test('특수관계자 주석이 없으면 null', () => {
  assert.equal(extractRelatedParty({ items: [{ no: 1, title: '일반 사항' }] }, 100), null)
})

// ── 우발상황 ────────────────────────────────────────────

const cnote = (body) => ({ items: [{ no: 30, title: '우발상황', body, content: [] }] })

test('부정문은 위험으로 세지 않는다', () => {
  // "소송은 존재하지 않습니다" 를 소송 1건으로 세면 뜻이 정반대가 된다.
  const c = extractContingencies(cnote('당기말 기준으로 회사가 피고로 계류 중인 소송은 존재하지 않습니다.'))
  assert.equal(c.present.length, 0)
  assert.equal(c.absent.length, 1)
  assert.equal(c.absent[0].kind, '소송')
  assert.deepEqual(c.kinds, [])
})

test('실제 소송·보증·담보는 잡는다', () => {
  const c = extractContingencies(
    cnote(
      '당사는 특허 침해 관련 손해배상 소송의 피고로 계류 중입니다.\n' +
        '당사는 종속기업의 차입금에 대하여 지급보증을 제공하고 있습니다.\n' +
        '토지와 건물이 차입금의 담보로 제공되어 있습니다.'
    )
  )
  assert.equal(c.present.length, 3)
  assert.deepEqual([...c.kinds].sort(), ['담보제공', '소송', '지급보증'].sort())
})

test('같은 문장이 여러 주석에 반복돼도 한 번만 싣는다', () => {
  const dup = '당사는 지급보증을 제공하고 있습니다.'
  const c = extractContingencies({
    items: [
      { no: 30, title: '우발상황', body: dup, content: [] },
      { no: 31, title: '약정사항', body: dup, content: [] },
    ],
  })
  assert.equal(c.present.length, 1)
})

test('우발상황 주석 자체가 없으면 null', () => {
  assert.equal(extractContingencies({ items: [{ no: 1, title: '일반 사항' }] }), null)
})
