// 런웨이 계산. "언제 돈이 떨어지나" 는 결론처럼 읽히므로 경계를 분명히 해 둔다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeRunway, runwayText } from '../src/lib/analyze/runway.js'

const v = (o) => Object.fromEntries(Object.entries(o).map(([k, c]) => [k, { current: c, prior: null }]))

test('현금을 태우면 남은 개월을 낸다', () => {
  // 현금 12억, 영업에서 연 12억 소진 → 12개월
  const r = computeRunway(v({ cash: 1_200_000_000, cfOperating: -1_200_000_000 }))
  assert.equal(r.burning, true)
  assert.equal(Math.round(r.monthsOperating), 12)
  assert.equal(Math.round(r.months), 12)
})

test('단기금융상품은 보유 현금에 더한다', () => {
  // 예치해 둔 돈은 사라진 돈이 아니다. 빼면 런웨이가 실제보다 짧게 나온다.
  const r = computeRunway(
    v({ cash: 600_000_000, shortTermInvest: 600_000_000, cfOperating: -1_200_000_000 })
  )
  assert.equal(r.cash, 1_200_000_000)
  assert.equal(Math.round(r.months), 12)
})

test('영업·투자 두 기준 중 짧은 쪽을 대표값으로 쓴다', () => {
  // 영업 -10억(14.4개월), 투자 -10억 → FCF -20억(7.2개월). 실제로 마주할 건 7.2개월.
  const r = computeRunway(
    v({ cash: 1_200_000_000, cfOperating: -1_000_000_000, cfInvesting: -1_000_000_000 })
  )
  assert.equal(Math.round(r.monthsOperating * 10) / 10, 14.4)
  assert.equal(Math.round(r.monthsFree * 10) / 10, 7.2)
  assert.equal(r.months, r.monthsFree)
  assert.equal(r.basis, 'free')
})

test('투자로 돈이 들어오면 FCF 기준이 더 길어지고, 그때는 영업 기준을 쓴다', () => {
  const r = computeRunway(
    v({ cash: 1_200_000_000, cfOperating: -1_200_000_000, cfInvesting: 600_000_000 })
  )
  assert.equal(Math.round(r.monthsOperating), 12)
  assert.equal(Math.round(r.monthsFree), 24)
  assert.equal(r.basis, 'operating')
  assert.equal(Math.round(r.months), 12)
})

test('현금이 들어오는 회사는 태우는 중이 아니다', () => {
  const r = computeRunway(v({ cash: 1_000_000_000, cfOperating: 500_000_000, cfInvesting: 100_000_000 }))
  assert.equal(r.burning, false)
  assert.equal(r.months, null)
})

test('영업은 흑자인데 투자가 커서 전체로는 마이너스인 경우', () => {
  const r = computeRunway(
    v({ cash: 1_200_000_000, cfOperating: 300_000_000, cfInvesting: -900_000_000 })
  )
  assert.equal(r.burnOperating, 0)
  assert.equal(r.burnFree, 600_000_000)
  assert.equal(r.burning, true)
  assert.equal(Math.round(r.months), 24)
})

test('숫자가 없으면 조용히 비운다 — 0으로 단정하지 않는다', () => {
  const r = computeRunway({})
  assert.equal(r.cash, null)
  assert.equal(r.months, null)
  assert.equal(r.burning, false)
  assert.equal(computeRunway(undefined).months, null)
})

test('경고 구간', () => {
  const band = (m) => computeRunway(v({ cash: m * 100_000_000, cfOperating: -1_200_000_000 })).band.tone
  assert.equal(band(5), 'bad') // 5개월
  assert.equal(band(10), 'warn') // 10개월
  assert.equal(band(20), 'info') // 20개월
  assert.equal(band(30), 'good') // 30개월
})

test('표기 — 2년이 넘으면 연 단위로 읽힌다', () => {
  assert.equal(runwayText(7.4), '약 7.4개월')
  assert.equal(runwayText(15), '약 15개월')
  assert.equal(runwayText(30), '약 2.5년')
  assert.equal(runwayText(null), '-')
})
