// 파싱 엔진 검증. 추출기(PDF/HTML)는 브라우저 API를 쓰므로, 여기서는 추출 결과와
// 같은 형태의 문서 모델을 텍스트 픽스처로 만들어 순수 파싱 로직만 검증한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { htmlifyDartCells } from '../src/lib/extract/html.js'

import { parseAmount, detectUnit } from '../src/lib/parse/numbers.js'
import { parseMeta } from '../src/lib/parse/meta.js'
import { parseNarrative } from '../src/lib/parse/opinion.js'
import { parseStatements } from '../src/lib/parse/statements.js'
import { parseNotes } from '../src/lib/parse/notes.js'
import { computeRatios, growth } from '../src/lib/analyze/ratios.js'
import { buildTimeline, seriesFor, splitByPeriodType } from '../src/lib/analyze/series.js'
import { detectPeriodType } from '../src/lib/parse/numbers.js'
import { normalizeCompany, displayCompany, accumulateCompany, companyView, reportIdOf } from '../src/lib/company.js'
import { waterfallSteps, headlineTiles } from '../src/lib/analyze/view.js'
import { toParagraphs } from '../src/lib/format.js'
import { parseShares } from '../src/lib/parse/shares.js'
import { valuate } from '../src/lib/analyze/valuation.js'
import { buildChecklist } from '../src/lib/analyze/checklist.js'
import { buildContent } from '../src/lib/parse/blocks.js'

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

test('연결/별도 표기가 달라도 같은 회사로 묶인다', () => {
  const pairs = [
    ['주식회사 무하유', '주식회사 무하유와 그 종속기업'],
    ['삼성전자주식회사', '삼성전자주식회사와 그 종속기업'],
    ['(주)가나다', '가나다 주식회사'],
    ['에이비씨 주식회사', '에이비씨주식회사 및 그 종속회사'],
  ]
  for (const [a, b] of pairs) {
    assert.equal(normalizeCompany(a), normalizeCompany(b), `${a} ↔ ${b}`)
  }
  // 다른 회사는 합쳐지지 않아야 한다
  assert.notEqual(normalizeCompany('가나다'), normalizeCompany('가나다홀딩스'))
  assert.notEqual(normalizeCompany('무하유'), normalizeCompany('무하유테크'))

  // 화면 표기는 종속기업 수식어를 뗀 이름을 쓴다
  assert.equal(displayCompany('주식회사 무하유와 그 종속기업'), '주식회사 무하유')

  // 파서도 연결 표제에서 회사명만 뽑아야 한다
  const d = docFromText('독립된 감사인의 감사보고서\n주식회사 무하유와 그 종속기업 주주 및 이사회 귀중\n감사의견\n연결 재무제표\n')
  assert.equal(parseMeta(d).company, '주식회사 무하유')
})

test('회사 문서에 보고기간이 누적된다', () => {
  const mk = (year, type, values, basis = '별도') => ({
    createdAt: 1000 + year,
    meta: { company: '주식회사 무하유', fiscalYear: year, periodType: type, periodLabel: type === 'FY' ? '연간' : '3분기', basis },
    periods: [{ id: 'current', year }, { id: 'prior', year: year - 1 }],
    values,
    opinion: { type: 'unqualified', label: '적정의견', tone: 'good' },
  })

  // 2024 감사보고서: 당기 2024 + 전기 2023 이 함께 누적된다
  let co = accumulateCompany(null, mk(2024, 'FY', { revenue: { current: 100, prior: 80 } }))
  assert.equal(co.key, normalizeCompany('주식회사 무하유'))
  assert.deepEqual(Object.keys(co.periods).sort(), ['FY-2023-s', 'FY-2024-s'])
  assert.equal(co.periods['FY-2024-s'].values.revenue, 100)
  assert.equal(co.periods['FY-2023-s'].values.revenue, 80)
  assert.equal(co.periods['FY-2023-s'].fromPrior, true)
  assert.equal(co.reportCount, 1)

  // 2023 감사보고서를 나중에 올려도, 2024 보고서에 실린 2023 비교치가 더 최신이라 유지된다
  // (회계기준 변경·오류수정으로 과거 수치가 재작성되면 나중 보고서 쪽이 맞다)
  co = accumulateCompany(co, mk(2023, 'FY', { revenue: { current: 81, prior: 60 } }))
  assert.equal(co.periods['FY-2023-s'].values.revenue, 80, '나중 보고서(2024)의 비교치가 우선한다')
  assert.equal(co.periods['FY-2024-s'].values.revenue, 100, '기존 연도는 유지되어야 한다')
  assert.equal(co.periods['FY-2022-s'].values.revenue, 60, '2023 보고서만 가진 연도는 새로 쌓인다')
  assert.deepEqual(Object.keys(co.periods).sort(), ['FY-2022-s', 'FY-2023-s', 'FY-2024-s'])
  assert.equal(co.reportCount, 2)
  assert.equal(co.latest.fiscalYear, 2024, '최신은 사업연도가 큰 쪽')

  // 재작성: 나중 보고서가 과거 연도 수치를 다르게 실으면 그 값으로 대체하고 표시를 남긴다
  let re = accumulateCompany(null, mk(2024, 'FY', { netIncome: { current: 680, prior: 2510 } }))
  assert.equal(re.periods['FY-2023-s'].values.netIncome, 2510)
  re = accumulateCompany(re, mk(2025, 'FY', { netIncome: { current: 767, prior: -1976 } }))
  assert.equal(re.periods['FY-2024-s'].values.netIncome, -1976, '2025 보고서의 재작성치가 우선한다')
  assert.equal(re.periods['FY-2024-s'].restated, true)
  assert.equal(re.periods['FY-2023-s'].values.netIncome, 2510, '더 옛 연도는 그대로 남는다')

  // 같은 보고서를 다시 올려도 보고서 수가 늘지 않는다 (중복 누적 방지)
  co = accumulateCompany(co, mk(2024, 'FY', { revenue: { current: 100, prior: 80 } }))
  assert.equal(co.reportCount, 2)

  // 분기보고서는 연간을 덮지 않고 별도 키로 쌓인다
  co = accumulateCompany(co, mk(2025, 'Q3', { revenue: { current: 70, prior: 65 } }))
  assert.ok(co.periods['Q3-2025-s'] && co.periods['Q3-2024-s'])
  assert.equal(co.periods['FY-2024-s'].values.revenue, 100)
  assert.equal(co.reportCount, 3)

  // 연결 보고서는 같은 회사 문서에 누적되지만, 별도 수치를 덮지 않는다
  co = accumulateCompany(co, mk(2024, 'FY', { revenue: { current: 130, prior: 105 } }, '연결'))
  assert.equal(co.reportCount, 4)
  assert.equal(co.key, normalizeCompany('무하유'))
  assert.equal(co.periods['FY-2024-s'].values.revenue, 100, '별도 값이 연결 값에 덮이면 안 된다')
  assert.equal(co.periods['FY-2024-c'].values.revenue, 130)

  // 추이는 기준을 섞지 않는다 — 연간 데이터가 가장 많이 쌓인 기준(별도 3개년)을 쓴다
  const view = companyView(co)
  assert.equal(view.name, '주식회사 무하유')
  assert.equal(view.primaryType, 'FY')
  assert.equal(view.trendBasis, '별도')
  assert.deepEqual(view.trend.map((p) => p.value), [60, 80, 100])
  assert.deepEqual(view.bases.sort(), ['별도', '연결'])

  // 연결 보고서가 더 많이 쌓이면 연결 기준으로 넘어간다
  let co2 = accumulateCompany(null, mk(2024, 'FY', { revenue: { current: 130, prior: 105 } }, '연결'))
  co2 = accumulateCompany(co2, mk(2022, 'FY', { revenue: { current: 90, prior: 70 } }, '연결'))
  co2 = accumulateCompany(co2, mk(2024, 'FY', { revenue: { current: 100, prior: 80 } }, '별도'))
  assert.equal(companyView(co2).trendBasis, '연결')
})

test('DART 원문 서식 — 글자 사이 공백 제목·주석참조 열·3열 비교표', () => {
  // 실제 DART PDF 는 제목을 "재 무 상 태 표" 처럼 글자마다 띄우고,
  // 주석 참조 열에 "23,31,32" 처럼 번호를 쉼표로 나열하며,
  // K-IFRS 최초채택 해에는 당기말·전기말·전기초 세 열을 싣는다.
  const d = docFromText(
    [
      '독립된 감사인의 감사보고서',
      '주식회사 무하유 주주 및 이사회 귀중',
      '감사의견',
      '우리의 의견으로 재무제표는 중요성의 관점에서 공정하게 표시하고 있습니다.',
      '이 감사보고서는 감사보고서일(2026년 3월 26일) 현재로 유효한 것입니다.',
      '삼정회계법인',
      '재 무 상 태 표',
      '제 15(당) 기 2025년 12월 31일 현재',
      '제 14(전) 기 2024년 12월 31일 현재',
      '회사명 : 주식회사 무하유\t(단위 : 원)',
      'Ⅰ. 유동자산\t26,251,731,189\t22,188,168,026\t20,853,982,155',
      'Ⅰ. 자본금\t19\t2,000,000,000\t100,000,000\t100,000,000',
      '자 | 산 | 총 | 계'.replace(/ \| /g, '\t') + '\t34,193,961,469\t30,344,985,559\t28,719,100,483',
      '부 채 및 자 본 총 계\t34,193,961,469\t30,344,985,559\t28,719,100,483',
      '포 괄 손 익 계 산 서',
      '제 15(당) 기 2025년 1월 1일부터 2025년 12월 31일까지',
      'Ⅰ. 영업수익\t23,31,32\t12,714,589,429\t11,064,018,372',
      'Ⅱ. 영업비용\t24,25\t10,515,123,932\t11,503,374,592',
      'Ⅲ. 영업이익(손실)\t2,199,465,497\t(439,356,220)',
      'Ⅴ. 당기순이익(손실)\t767,076,809\t(1,976,143,886)',
      '4. 선수금\t-\t18,392,800',
      '19. 현금흐름표',
      '이 주석은 재무제표의 일부입니다.',
    ].join('\n')
  )
  const m = parseMeta(d)
  const s = parseStatements(d, m)

  // 글자 사이 공백 제목을 본표로 인식한다
  const stmts = s.blocks.map((b) => b.stmt)
  assert.ok(stmts.includes('BS'), '재 무 상 태 표 인식 실패')
  assert.ok(stmts.includes('CI'), '포 괄 손 익 계 산 서 인식 실패')
  // "19. 현금흐름표" 는 주석 표제라 본표가 아니다
  assert.ok(!stmts.includes('CF'), '주석 표제를 본표로 오인')

  // 주석 참조 열("23,31,32")을 금액으로 읽지 않는다
  assert.equal(parseAmount('23,31,32'), null)
  assert.equal(parseAmount('24,25'), null)
  assert.equal(s.values.revenue.current, 12714589429)
  assert.equal(s.values.revenue.prior, 11064018372)
  assert.equal(s.values.operatingProfit.current, 2199465497)
  assert.equal(s.values.operatingProfit.prior, -439356220)
  assert.equal(s.values.netIncome.current, 767076809)

  // 글자 사이 공백 계정과목과 3열 비교표(당기말·전기말·전기초)
  assert.equal(s.values.totalAssets.current, 34193961469)
  assert.equal(s.values.totalAssets.prior, 30344985559)
  assert.equal(s.values.totalLiabEquity.current, 34193961469)
  assert.equal(s.values.capitalStock.current, 2000000000) // 주석열 '19' 를 걸러야 통과

  // "-" 는 자리를 지켜 당기/전기가 밀리지 않는다
  const seonsu = s.blocks.flatMap((b) => b.rows).find((r) => /선수금/.test(r.label || ''))
  assert.deepEqual(seonsu.values, [null, 18392800])

  // 영업수익/영업비용 구조에는 매출총이익이 없다
  assert.equal(s.values.grossProfit, undefined, '매출원가가 없는데 매출총이익을 만들면 안 된다')
  assert.equal(s.values.operatingExpense.current, 10515123932)

  assert.equal(m.reportDate, '2026-03-26')
  assert.equal(s.basis, '별도', '본문에 연결 언급이 없으면 별도')
})

test('연결 본표 제목이면 연결로 판정한다', () => {
  const d = docFromText(
    [
      '연 결 재 무 상 태 표',
      '제 15(당) 기 2025년 12월 31일 현재',
      '자 산 총 계\t34,188,231,721\t30,344,985,559',
      '부 채 총 계\t23,343,055,283\t20,558,387,713',
      '자 본 총 계\t10,845,176,438\t9,786,597,846',
    ].join('\n')
  )
  const s = parseStatements(d, parseMeta(d))
  assert.equal(s.basis, '연결')
  assert.equal(s.values.totalAssets.current, 34188231721)
})

test('주석 안의 표는 문단으로 뭉개지 않고 표로 남는다', () => {
  // 실제 감사보고서 "비용의 성격별 분류" 주석 형태 (탭이 셀 경계)
  const d = docFromText(
    [
      '주석',
      '1. 회사의 개요',
      '당사는 시스템 소프트웨어 개발 및 공급을 목적으로 설립되었습니다.',
      '24. 비용의 성격별 분류',
      '당기 및 전기 중 비용의 성격별 분류에 대한 내역은 다음과 같습니다. (단위: 원)',
      '구분\t당기\t전기',
      '종업원급여\t6,661,227,265\t7,306,901,198',
      '주식보상비용\t300,909,576\t180,907,185',
      '복리후생비\t486,541,111\t609,098,175',
      '합 계\t10,524,941,947\t11,537,599,977',
      '위 금액은 매출원가와 판매비와관리비를 합한 금액입니다.',
    ].join('\n')
  )

  const parsed = parseNotes(d)
  const note = parsed.items.find((n) => n.no === 24)
  assert.ok(note, '24번 주석 누락')

  const kinds = note.content.map((b) => b.type)
  assert.deepEqual(kinds, ['p', 'table', 'p'], `블록 구성: ${kinds.join(',')}`)

  const table = note.content[1]
  assert.deepEqual(table.header, ['구분', '당기', '전기'], '열 제목을 머리행으로 끌어올려야 한다')
  assert.equal(table.rows.length, 4)
  assert.deepEqual(table.rows[0], ['종업원급여', '6,661,227,265', '7,306,901,198'])
  assert.deepEqual(table.rows[3], ['합 계', '10,524,941,947', '11,537,599,977'])

  // 표 앞뒤 설명은 문단으로 남는다
  assert.match(note.content[0].text, /성격별 분류에 대한 내역/)
  assert.match(note.content[2].text, /매출원가와 판매비와관리비/)

  // body 는 검색용으로 전체 텍스트를 그대로 보존한다
  assert.match(note.body, /종업원급여/)
  assert.match(note.body, /6,661,227,265/)
})

test('PDF 종이 줄바꿈을 문단으로 다시 흘린다', () => {
  // PDF 추출 결과는 종이 한 줄마다 개행이 들어 있다.
  const raw = [
    '주식회사 무하유(이하 "당사")는 시스템 소프트웨어 개발 및 공급을 목적으로 2011년7월',
    '8일 설립되었습니다. 당사의 본사는 서울특별시 성동구 성수동로 5에 소재하고 있으며,',
    '당사의 자본금은 2,000,000,000원입니다.',
    '2.1 재무제표 작성기준',
    '당사는 2025년 1월 1일 이후에 개시하는 연차보고기간부터 국제회계기준을 채택하여',
    '재정한 한국채택국제회계기준을 적용하고 있습니다.',
  ].join('\n')

  const paras = toParagraphs(raw)
  // 첫 문단은 세 줄이 한 문단으로 합쳐진다
  assert.ok(paras[0].includes('2011년7월 8일 설립되었습니다'), `문단 이어붙이기 실패: ${paras[0]}`)
  assert.ok(paras[0].endsWith('2,000,000,000원입니다.'))
  // 번호가 붙은 소제목은 새 문단으로 끊긴다
  assert.equal(paras[1], '2.1 재무제표 작성기준')
  assert.ok(paras[2].includes('국제회계기준을 채택하여 재정한'))
  assert.equal(paras.length, 3)

  // 빈 줄은 문단 경계로 유지된다
  assert.equal(toParagraphs('가나다 라마바\n\n사아자 차카타').length, 2)
  assert.deepEqual(toParagraphs(''), [])
})

test('보고기간 종류 판정 — 연간 · 반기 · 분기', () => {
  assert.equal(detectPeriodType('제 15 기 2024년 1월 1일부터 2024년 12월 31일까지').type, 'FY')
  assert.equal(detectPeriodType('제 15 기 3분기 2024년 1월 1일부터 2024년 9월 30일까지').type, 'Q3')
  assert.equal(detectPeriodType('제 15 기 반기 2024년 1월 1일부터 2024년 6월 30일까지').type, 'H1')
  assert.equal(detectPeriodType('제 15 기 1분기 2024년 1월 1일부터 2024년 3월 31일까지').type, 'Q1')
  assert.equal(detectPeriodType('2024년 12월 31일 현재').type, 'FY')
  // 종료일 표기가 없으면 표제 키워드로 되짚는다
  assert.equal(detectPeriodType('분기보고서 제3분기').type, 'Q3')
  assert.equal(detectPeriodType('반기보고서').type, 'H1')
  // 감사보고서 픽스처는 연간으로 잡혀야 한다
  assert.equal(meta.periodType, 'FY')
  assert.equal(meta.periodLabel, '연간')
})

test('분기보고서는 연간 추이와 같은 축에 섞이지 않는다', () => {
  const annual = {
    id: 'fy',
    meta: { ...meta, fiscalYear: 2024, periodType: 'FY' },
    periods: [{ id: 'current', year: 2024 }, { id: 'prior', year: 2023 }],
    values: { revenue: { current: 128400000000, prior: 104200000000 } },
  }
  const q3 = {
    id: 'q3',
    meta: { ...meta, fiscalYear: 2025, periodType: 'Q3' },
    periods: [{ id: 'current', year: 2025 }, { id: 'prior', year: 2024 }],
    values: { revenue: { current: 99000000000, prior: 92000000000 } },
  }

  const groups = splitByPeriodType([annual, q3])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].type, 'FY') // 연간 우선
  assert.equal(groups[1].type, 'Q3')

  // 연간 축에는 3분기 누적치가 들어오지 않는다
  const fyLine = buildTimeline(groups[0].reports)
  assert.deepEqual(fyLine.years, [2023, 2024])
  assert.equal(fyLine.byYear.get(2024).values.revenue, 128400000000)

  // 분기 축은 따로, 라벨에 기간 종류가 붙는다
  const q3Line = buildTimeline(groups[1].reports, { labelSuffix: '3분기' })
  assert.deepEqual(q3Line.years, [2024, 2025])
  assert.equal(q3Line.rows[1].label, '2025년 3분기')
  assert.equal(q3Line.byYear.get(2024).values.revenue, 92000000000)
})

test('주주·임원 추출 — 기관명을 사람으로 잡지 않는다', () => {
  const doc = docFromText(
    [
      '1. 일반 사항',
      '당기말 현재 최대 주주(보통주)이자 대표이사인 신동호는 2,717,600주(지분율 67.94%)의 주식을 보유하고 있습니다.',
      '감사인 삼정회계법인은 2,717,600주를 보유하고 있습니다.',
      '수권주식수\t50,000,000주\t80,000주',
      '발행주식수\t4,000,000주\t20,000주',
    ].join('\n')
  )
  const s = parseShares(doc, parseNotes(doc))
  assert.equal(s.majorShareholder.name, '신동호')
  assert.equal(s.majorShareholder.shares, 2717600)
  assert.equal(s.majorShareholder.ratio, 67.94)
  assert.equal(s.issuedShares, 4000000)
  assert.equal(s.authorizedShares, 50000000)

  // '감사인'은 회계법인이지 임원이 아니다 — '감사' 역할로 잡히면 안 된다
  assert.deepEqual(s.executives.map((e) => e.name), ['신동호'])
  assert.equal(s.executives[0].role, '대표이사')
})

test('기업가치 — 가정과 경계값', () => {
  // 적자면 PER 방법을 만들지 않는다
  const loss = valuate({ totalEquity: { current: 1000 }, netIncome: { current: -50 } }, [], null)
  assert.equal(loss.methods.some((m) => m.key === 'per'), false)

  // 발행주식 0 은 값이 없는 것과 같다(0 으로 나누지 않는다)
  const zero = valuate({ totalEquity: { current: 1000 } }, [], { issuedShares: 0 })
  assert.equal(zero.issuedShares, null)
  assert.deepEqual(zero.perShare, [])

  // 상증법: 최근 3개년 3:2:1 가중평균
  const rows = [
    { year: 2023, netIncome: 100 },
    { year: 2024, netIncome: 200 },
    { year: 2025, netIncome: 300 },
  ]
  const v = valuate({ totalEquity: { current: 1000 } }, rows, { issuedShares: 10 })
  const stat = v.methods.find((m) => m.key === 'statutory')
  assert.ok(stat, '상증법 평가 누락')
  assert.equal(round(stat.weightedProfit, 2), 233.33)

  // 순손익이 작으면 순자산가치의 80% 가 하한이 된다
  const floored = valuate({ totalEquity: { current: 1000 } }, [{ year: 2025, netIncome: 1 }], { issuedShares: 10 })
  assert.equal(round(floored.methods.find((m) => m.key === 'statutory').perShare, 2), 80)
})

test('점검 체크리스트 — 자본잠식·경계값', () => {
  const wiped = buildChecklist({ values: { capitalStock: { current: 100 }, totalEquity: { current: -5 } } }, { rows: [] }, null)
  const w = wiped.items.find((i) => i.id === 'capitalImpairment')
  assert.equal(w.status, 'bad')
  assert.match(w.value, /완전자본잠식/)

  const partial = buildChecklist({ values: { capitalStock: { current: 100 }, totalEquity: { current: 60 } } }, { rows: [] }, null)
  assert.equal(partial.items.find((i) => i.id === 'capitalImpairment').status, 'warn')

  // 영업이익이 0 이면 괴리 항목을 만들지 않는다(0으로 나누지 않는다)
  const zeroOp = buildChecklist({ values: { operatingProfit: { current: 0 }, netIncome: { current: 10 } } }, { rows: [] }, null)
  assert.equal(zeroOp.items.some((i) => i.id === 'nonOperating'), false)

  // 결산일보다 앞선 날짜는 감사 지연으로 보지 않는다
  const badDate = buildChecklist({ meta: { fiscalYear: 2024, reportDate: '2024-06-01' } }, { rows: [] }, null)
  assert.equal(badDate.items.some((i) => i.id === 'lag'), false)

  // 데이터가 없어도 점검 항목은 만들어진다
  assert.ok(buildChecklist({}, { rows: [] }, null).checked > 0)
})

test('본문 블록 — 목차는 정렬용 블록으로 분리한다', () => {
  const toc = buildContent([
    { text: '감 사 보 고 서 ...........................1', cells: ['감 사 보 고 서 ...........................1'] },
    { text: '주석....................................11', cells: ['주석....................................11'] },
  ])
  assert.equal(toc.length, 1)
  assert.equal(toc[0].type, 'toc')
  assert.deepEqual(toc[0].rows.map((r) => r.page), [1, 11])

  // 일반 문장은 표로 오인하지 않는다
  const para = buildContent([{ text: '당사는 2011년에 설립되었습니다.', cells: ['당사는 2011년에 설립되었습니다.'] }])
  assert.equal(para[0].type, 'p')
})

function round(n, d) {
  return n == null ? null : Number(n.toFixed(d))
}

// ── DART 원문의 표 셀 태그 ─────────────────────────────────────
//
// DART 원문(dart4.xsd)은 <TD> 대신 <TE>·<TU> 를 쓴다. HTML 파서는 모르는 태그를
// <table> 밖으로 밀어내므로(foster parenting), 바꾸지 않으면 한 <TR> 의
// 계정과목·당기·전기가 각각 다른 행으로 흩어져 전기 금액이 통째로 사라진다.
// (무하유 2024년 감사보고서 실제 증상: 33개 계정 중 전기 인식 1개)

test('DART 셀 태그 — TE 를 td 로 바꾸고 속성은 살린다', () => {
  const out = htmlifyDartCells('<TR><TE ALIGN="RIGHT" ADELIM="2" WIDTH="111">21,552,026,955</TE></TR>')
  assert.equal(out, '<TR><td ALIGN="RIGHT" ADELIM="2" WIDTH="111">21,552,026,955</td></TR>')
})

test('DART 셀 태그 — TU 도 바꾼다', () => {
  assert.equal(htmlifyDartCells('<TU WIDTH="80">(단위 : 원)</TU>'), '<td WIDTH="80">(단위 : 원)</td>')
})

test('DART 셀 태그 — colspan/rowspan 이 보존된다', () => {
  const out = htmlifyDartCells('<TE COLSPAN="2" ROWSPAN="3">자 산</TE>')
  assert.match(out, /^<td COLSPAN="2" ROWSPAN="3">/)
})

test('DART 셀 태그 — 표준 TD·TH 와 다른 태그는 건드리지 않는다', () => {
  const src = '<TD>가</TD><TH>나</TH><TEXT>다</TEXT><TERM>라</TERM>'
  assert.equal(htmlifyDartCells(src), src)
})

test('DART 셀 태그 — 빈 셀과 자기닫음 셀도 처리한다', () => {
  assert.equal(htmlifyDartCells('<TE ADELIM="1"></TE>'), '<td ADELIM="1"></td>')
  assert.equal(htmlifyDartCells('<TE ADELIM="1"/>'), '<td ADELIM="1"/>')
})
