// 파싱 엔진 검증. 추출기(PDF/HTML)는 브라우저 API를 쓰므로, 여기서는 추출 결과와
// 같은 형태의 문서 모델을 텍스트 픽스처로 만들어 순수 파싱 로직만 검증한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { parseAmount, detectUnit } from '../src/lib/parse/numbers.js'
import { parseMeta } from '../src/lib/parse/meta.js'
import { parseNarrative } from '../src/lib/parse/opinion.js'
import { parseStatements } from '../src/lib/parse/statements.js'
import { parseNotes } from '../src/lib/parse/notes.js'
import { computeRatios, growth } from '../src/lib/analyze/ratios.js'
import { buildTimeline, seriesFor } from '../src/lib/analyze/series.js'
import { waterfallSteps, headlineTiles } from '../src/lib/analyze/view.js'

const here = dirname(fileURLToPath(import.meta.url))

/** 추출기 출력과 동일한 { rows, fullText } 형태로 만든다. */
function docFromText(text, fileName = 'fixture.pdf') {
  const rows = text
    .split(/\r?\n/)
    .map((line, i) => {
      const cells = line.split('\t').map((c) => c.trim()).filter((c) => c !== '')
      return { page: Math.floor(i / 45) + 1, y: -i, cells: cells.length ? cells : [line.trim()], text: line.replace(/\t/g, '\t').trim() }
    })
    .filter((r) => r.text)
  return { kind: 'pdf', pageCount: Math.ceil(rows.length / 45), rows, fullText: rows.map((r) => r.text).join('\n'), fileName, fileSize: text.length }
}

const fixture = readFileSync(join(here, 'fixtures/hanbit-2024.txt'), 'utf-8')
const doc = docFromText(fixture)
const meta = parseMeta(doc)
const narrative = parseNarrative(doc)
const statements = parseStatements(doc, meta)
const notes = parseNotes(doc)
const values = statements.values
const ratios = computeRatios(values)

test('금액 표기 정규화', () => {
  assert.equal(parseAmount('1,234,567'), 1234567)
  assert.equal(parseAmount('(310,000,000)'), -310000000)
  assert.equal(parseAmount('△1,500'), -1500)
  assert.equal(parseAmount('-'), null)
  assert.equal(parseAmount(''), null)
  assert.equal(parseAmount('자산총계'), null)
  assert.equal(parseAmount('1,235'), 1235)
  assert.equal(parseAmount('12.5'), 12.5)
  assert.equal(detectUnit('주식회사 한빛테크 (단위: 원)').factor, 1)
  assert.equal(detectUnit('(단위: 천원)').factor, 1000)
  assert.equal(detectUnit('(단위: 백만원)').factor, 1e6)
})

test('표지 메타 정보', () => {
  assert.match(meta.company, /한빛테크/)
  assert.equal(meta.fiscalYear, 2024)
  assert.equal(meta.termNo, 15)
  assert.equal(meta.auditor, '삼일회계법인')
  assert.equal(meta.reportDate, '2025-03-14')
  assert.equal(meta.basis, '별도')
  assert.equal(meta.docKind, '감사보고서')
})

test('회사명은 줄을 넘어 표제까지 흡수하지 않는다', () => {
  const d = docFromText(`독립된 감사인의 감사보고서
주식회사 한빛테크 주주 및 이사회 귀중
감사의견
`)
  assert.equal(parseMeta(d).company, '주식회사 한빛테크')

  // 표제와 회사명이 한 줄에 붙은 경우도 표제를 떼어낸다
  const d2 = docFromText('독립된 감사인의 감사보고서 (주)가나다 주주 및 이사회 귀중\n감사의견\n')
  assert.equal(parseMeta(d2).company, '(주)가나다')
})

test('감사의견 판정과 절 분리', () => {
  assert.equal(narrative.opinion.type, 'unqualified')
  assert.equal(narrative.opinion.label, '적정의견')
  assert.match(narrative.opinion.text, /공정하게 표시하고 있습니다/)
  assert.match(narrative.opinion.basis, /회계감사기준/)
  assert.equal(narrative.goingConcern.flagged, false)
  assert.ok(narrative.kam.items.length >= 2, `KAM ${narrative.kam.items.length}개`)
  assert.match(narrative.kam.items[0].title, /수익인식/)
  assert.match(narrative.emphasis, /지급보증/)
  assert.equal(narrative.auditPartner, '김성우')
  const keys = narrative.sections.map((s) => s.key)
  for (const k of ['opinion', 'basis', 'kam', 'emphasis', 'mgmtResp', 'auditorResp']) {
    assert.ok(keys.includes(k), `${k} 절 누락`)
  }
})

test('기간 인식: 당기 2024 · 전기 2023', () => {
  assert.deepEqual(statements.periods.map((p) => p.year), [2024, 2023])
})

test('재무제표 블록 인식', () => {
  const stmts = new Set(statements.blocks.map((b) => b.stmt))
  for (const s of ['BS', 'IS', 'CF']) assert.ok(stmts.has(s), `${s} 블록 누락`)
  assert.ok(statements.blocks.every((b) => b.rows.length > 0))
})

test('재무상태표 금액 — 주석 참조 열을 금액으로 오인하지 않는다', () => {
  assert.equal(values.totalAssets.current, 107420610000)
  assert.equal(values.totalAssets.prior, 96330920000)
  assert.equal(values.currentAssets.current, 45320110000)
  assert.equal(values.cash.current, 12450000000) // 주석 열 '4' 를 걸러야 통과
  assert.equal(values.tradeReceivables.current, 18200300000)
  assert.equal(values.inventories.current, 14669810000)
  assert.equal(values.ppe.current, 48300000000)
  assert.equal(values.totalLiabilities.current, 56900000000)
  assert.equal(values.totalEquity.current, 50520610000)
  assert.equal(values.capitalStock.current, 5000000000)
  assert.equal(values.retainedEarnings.current, 37320610000)
})

test('대차 일치', () => {
  assert.equal(values.totalAssets.current, values.totalLiabilities.current + values.totalEquity.current)
  assert.equal(values.totalAssets.prior, values.totalLiabilities.prior + values.totalEquity.prior)
})

test('손익계산서 금액 — 괄호 음수 처리', () => {
  assert.equal(values.revenue.current, 128400000000)
  assert.equal(values.revenue.prior, 104200000000)
  assert.equal(values.cogs.current, 89880000000)
  assert.equal(values.grossProfit.current, 38520000000)
  assert.equal(values.sgna.current, 21300000000)
  assert.equal(values.operatingProfit.current, 17220000000)
  assert.equal(values.financeCost.current, -1980000000)
  assert.equal(values.pretaxProfit.current, 15830000000)
  assert.equal(values.incomeTax.current, -3480600000)
  assert.equal(values.netIncome.current, 12349400000)
  assert.equal(values.eps.current, 1235) // 주당금액은 단위 환산 대상이 아니다
})

test('현금흐름표 금액', () => {
  assert.equal(values.cfOperating.current, 15880000000)
  assert.equal(values.cfInvesting.current, -9340000000)
  assert.equal(values.cfFinancing.current, -3970000000)
  assert.equal(values.cfEnd.current, 12450000000)
})

test('주석 분리', () => {
  assert.equal(notes.found, true)
  assert.ok(notes.count >= 5, `주석 ${notes.count}개`)
  assert.equal(notes.items[0].no, 1)
  assert.match(notes.items[0].title, /회사의 개요/)
  assert.match(notes.items[0].body, /산업용 계측장비/)
  const related = notes.items.find((n) => /특수관계자/.test(n.title))
  assert.ok(related, '특수관계자 주석 누락')
  assert.match(related.body, /지급보증/)
})

test('재무비율', () => {
  const r = ratios.current
  assert.equal(round(r.opMargin, 2), 13.41) // 17,220 / 128,400
  assert.equal(round(r.netMargin, 2), 9.62)
  assert.equal(round(r.debtRatio, 1), 112.6) // 56,900 / 50,520
  assert.equal(round(r.currentRatio, 1), 141.2) // 45,320 / 32,100
  assert.equal(round(r.equityRatio, 1), 47.0)
  assert.equal(round(r.roe, 1), 24.4)
  assert.ok(ratios.prior.opMargin > 0)
  // 이자보상배율: 영업이익 / 금융원가(절대값이 아닌 원값이므로 음수가 되어선 안 된다)
  assert.ok(r.interestCoverage != null)
})

test('전년 대비 증감률', () => {
  assert.equal(round(growth(values.revenue.current, values.revenue.prior), 1), 23.2)
  assert.equal(round(growth(values.operatingProfit.current, values.operatingProfit.prior), 1), 67.6)
  assert.equal(round(growth(values.netIncome.current, values.netIncome.prior), 1), 87.2)
})

test('보고서 1건으로 2개 연도 추이가 만들어진다', () => {
  const report = { id: 'r1', meta, periods: statements.periods, values }
  const tl = buildTimeline([report])
  assert.deepEqual(tl.years, [2023, 2024])
  const s = seriesFor(tl, ['revenue', 'operatingProfit'])
  assert.equal(s[0].revenue, 104200000000)
  assert.equal(s[1].revenue, 128400000000)
  assert.equal(round(s[1].revenue__growth, 1), 23.2)
  assert.equal(round(tl.byYear.get(2024).ratios.opMargin, 2), 13.41)
})

test('여러 연도 보고서를 합치면 축이 늘어난다', () => {
  const r2024 = { id: 'a', meta, periods: statements.periods, values }
  const r2022 = {
    id: 'b',
    meta: { ...meta, fiscalYear: 2022 },
    periods: [{ id: 'current', year: 2022 }, { id: 'prior', year: 2021 }],
    values: { revenue: { current: 81000000000, prior: 60000000000 } },
  }
  const tl = buildTimeline([r2024, r2022])
  assert.deepEqual(tl.years, [2021, 2022, 2023, 2024])
  assert.equal(tl.byYear.get(2022).values.revenue, 81000000000)
  assert.equal(tl.byYear.get(2021).values.revenue, 60000000000)
})

test('워터폴 · 주요 지표 타일', () => {
  const steps = waterfallSteps(values)
  const labels = steps.map((s) => s.label)
  assert.ok(labels.includes('매출액') && labels.includes('영업이익') && labels.includes('당기순이익'))
  assert.equal(steps.find((s) => s.label === '매출원가').value, -89880000000)
  // 합계 항목을 이어 붙였을 때 순이익까지 도달한다
  assert.equal(steps.find((s) => s.label === '당기순이익').value, 12349400000)

  const tiles = headlineTiles(values)
  assert.ok(tiles.length >= 7)
  assert.equal(tiles.find((t) => t.key === 'revenue').value, 128400000000)
})

test('단위가 천원인 문서는 원으로 환산한다', () => {
  const thousand = `재무상태표
제 3 (당) 기 2024년 12월 31일 현재
주식회사 테스트	(단위: 천원)
과목	주석	제 3 (당) 기	제 2 (전) 기
자산총계		1,000,000	900,000
부채총계		400,000	380,000
자본총계		600,000	520,000
`
  const d = docFromText(thousand)
  const m = parseMeta(d)
  const s = parseStatements(d, m)
  assert.equal(s.values.totalAssets.current, 1000000000)
  assert.equal(s.values.totalEquity.prior, 520000000)
})

test('의견거절·계속기업 불확실성 판정', () => {
  const bad = `독립된 감사인의 감사보고서
주식회사 위험 주주 및 이사회 귀중
의견거절
우리는 감사범위의 제한으로 인하여 재무제표에 대한 의견을 표명하지 아니합니다.
의견거절의 근거
회사의 매출채권에 대한 감사증거를 입수할 수 없었습니다.
계속기업 관련 중요한 불확실성
회사는 당기 중 계속기업으로서의 존속능력에 유의적 의문을 제기할 수 있는 중요한 불확실성이 존재합니다.
2025년 3월 20일
대주회계법인
`
  const d = docFromText(bad)
  const n = parseNarrative(d)
  assert.equal(n.opinion.type, 'disclaimer')
  assert.equal(n.opinion.tone, 'critical')
  assert.equal(n.goingConcern.flagged, true)
  assert.match(parseMeta(d).auditor, /대주회계법인/)
})

test('한정의견 판정', () => {
  const d = docFromText(`독립된 감사인의 감사보고서
감사의견
우리의 의견으로는 한정의견의 근거 단락에 기술된 사항이 미치는 영향을 제외하고는 재무제표는 중요성의 관점에서 공정하게 표시하고 있습니다.
한정의견의 근거
재고자산 실사에 입회하지 못하였습니다.
`)
  assert.equal(parseNarrative(d).opinion.type, 'qualified')
})

function round(n, d) {
  return n == null ? null : Number(n.toFixed(d))
}
