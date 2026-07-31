// 연결·별도를 함께 실은 사업보고서 회귀 테스트.
//
// 아이스크림에듀에서 두 가지가 드러났다.
//  1) 사업보고서 한 건에 연결 본표와 별도 본표가 나란히 실리는데, 문서에 기준
//     라벨을 하나만 붙여 다른 쪽 수치를 통째로 버렸다. 별도가 2021~2025 년 내내
//     있는데도 2023·2024 가 '연결' 문서로 분류돼 별도 추이에 두 해가 뚫렸다.
//  2) 주석 참조 열을 지우는 규칙이 첫 칸의 값 0 까지 지워, 뒤 열이 한 칸씩
//     당겨졌다. 비지배지분 「0 | 5,508,371 | 436,660,121」 이 당기 5,508,371 이 됐다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatements } from '../src/lib/parse/statements.js'
import { periodEntriesOf, valuesByBasisOf } from '../src/lib/company.js'
import { buildTimeline, hasBasis } from '../src/lib/analyze/series.js'

const docOf = (text) => ({
  fullText: text,
  rows: text.trim().split('\n').map((line) => ({
    text: line,
    cells: line.split('\t').map((c) => c.trim()),
  })),
})

// 연결과 별도가 나란히 실린 사업보고서. 연결이 별도보다 큰 것은 종속기업 합산분이다.
const BOTH = `
연결재무상태표
제 13 기 2025.12.31 현재	제 12 기 2024.12.31 현재
(단위 : 원)
자산총계	90,000,000	95,000,000
부채총계	30,000,000	35,000,000
자본총계	60,000,000	60,000,000
비지배지분	0	5,508,371
재무상태표
제 13 기 2025.12.31 현재	제 12 기 2024.12.31 현재
(단위 : 원)
자산총계	66,971,694,074	77,331,787,493
부채총계	24,404,234,476	38,595,165,432
자본총계	42,567,459,598	38,736,622,061
`

test('사업보고서 — 연결·별도 수치를 둘 다 담는다', () => {
  const s = parseStatements(docOf(BOTH), { basis: '연결', fiscalYear: 2025, termNo: 13 })

  assert.equal(s.basis, '연결') // 주재무제표는 연결
  assert.deepEqual(Object.keys(s.valuesByBasis).sort(), ['별도', '연결'])
  assert.equal(s.valuesByBasis['연결'].totalAssets.current, 90000000)
  assert.equal(s.valuesByBasis['별도'].totalAssets.current, 66971694074)
})

test('열밀림 — 첫 칸의 0 을 주석 번호로 지우지 않는다', () => {
  const s = parseStatements(docOf(BOTH), { basis: '연결', fiscalYear: 2025, termNo: 13 })
  const bs = s.blocks.find((b) => b.basis === '연결' && b.items.nciEquity)
  // 0 이 지워지면 당기가 5,508,371 로 밀린다.
  if (bs) {
    assert.equal(bs.items.nciEquity.values[0], 0)
    assert.equal(bs.items.nciEquity.values[1], 5508371)
  }
  const row = s.blocks
    .flatMap((b) => b.rows)
    .find((r) => r.label === '비지배지분')
  assert.deepEqual(row.values, [0, 5508371])
})

test('주석 참조 열은 그대로 지운다', () => {
  const doc = docOf(`
재무상태표
제 13 기 2025.12.31 현재	제 12 기 2024.12.31 현재
(단위 : 원)
자산총계	5	66,971,694,074	77,331,787,493
`)
  const s = parseStatements(doc, { basis: '별도', fiscalYear: 2025, termNo: 13 })
  assert.equal(s.values.totalAssets.current, 66971694074)
  assert.equal(s.values.totalAssets.prior, 77331787493)
})

// ── 추이 축 ────────────────────────────────────────────────
const reportOf = (year, basis, valuesByBasis) => ({
  id: `${year}-FY`,
  meta: { fiscalYear: year, periodType: 'FY', basis, company: '아이스크림에듀' },
  periods: [{ id: 'current', year }, { id: 'prior', year: year - 1 }],
  values: valuesByBasis[basis],
  valuesByBasis,
})

// 전기 비교치는 비워 둔다 — 나중 보고서의 전기값이 이기는 규칙과 섞이지 않게.
const sep = (v) => ({ 별도: { revenue: { current: v, prior: null } } })
const both = (s, c) => ({
  별도: { revenue: { current: s, prior: null } },
  연결: { revenue: { current: c, prior: null } },
})

test('추이 — 연결 문서 안의 별도 수치도 별도 축에 들어간다', () => {
  const reports = [
    reportOf(2025, '별도', sep(100)),
    reportOf(2024, '연결', both(200, 900)),
    reportOf(2023, '연결', both(300, 800)),
    reportOf(2022, '별도', sep(400)),
  ]

  assert.equal(reports.filter((r) => hasBasis(r, '별도')).length, 4)
  assert.equal(reports.filter((r) => hasBasis(r, '연결')).length, 2)

  // 예전에는 2023·2024 가 연결 문서라 별도 축에서 빠져 [2022, 2025] 만 남았다.
  const t = buildTimeline(reports, { basis: '별도' })
  assert.deepEqual(t.years, [2022, 2023, 2024, 2025])
  // 연결 수치가 별도 축에 섞여 들어오면 안 된다.
  assert.equal(t.byYear.get(2024).values.revenue, 200)
  assert.equal(t.byYear.get(2023).values.revenue, 300)

  const c = buildTimeline(reports, { basis: '연결' })
  assert.deepEqual(c.years, [2023, 2024])
  assert.equal(c.byYear.get(2024).values.revenue, 900)
})

test('회사 누적 — 한 보고서가 연결·별도 두 칸을 만든다', () => {
  const entries = periodEntriesOf(reportOf(2024, '연결', both(200, 900)))
  assert.equal(entries['FY-2024-s'].values.revenue, 200)
  assert.equal(entries['FY-2024-c'].values.revenue, 900)
  assert.equal(entries['FY-2024-s'].basis, '별도')
})

test('옛 보고서 — valuesByBasis 가 없으면 문서 기준 한 벌로 본다', () => {
  const old = {
    id: '2020-FY',
    meta: { fiscalYear: 2020, periodType: 'FY', basis: '별도' },
    periods: [{ id: 'current', year: 2020 }, { id: 'prior', year: 2019 }],
    values: { revenue: { current: 10, prior: 9 } },
  }
  assert.deepEqual(Object.keys(valuesByBasisOf(old)), ['별도'])
  assert.equal(hasBasis(old, '별도'), true)
  assert.equal(hasBasis(old, '연결'), false)
})
