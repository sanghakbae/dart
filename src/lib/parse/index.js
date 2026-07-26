import { extractDocument } from '../extract/index.js'
import { parseMeta } from './meta.js'
import { parseNarrative } from './opinion.js'
import { parseStatements } from './statements.js'
import { parseNotes } from './notes.js'
import { computeRatios, buildInsights } from '../analyze/ratios.js'
import { companyKeyOf, reportIdOf } from '../company.js'

const KEY_ACCOUNTS = [
  'totalAssets', 'totalLiabilities', 'totalEquity', 'currentAssets', 'currentLiabilities',
  'revenue', 'operatingProfit', 'netIncome', 'cfOperating',
]

/** 파일 하나 → 분석된 보고서 객체 */
export async function analyzeFile(file, onProgress) {
  const doc = await extractDocument(file, onProgress)
  onProgress?.(0.72, '표지·감사의견 해석 중')

  const meta = parseMeta(doc)
  const narrative = parseNarrative(doc)

  onProgress?.(0.82, '재무제표 표 복원 중')
  const statements = parseStatements(doc, meta)

  // 누적 키가 '연도'이므로 연도 판정이 가장 중요하다.
  // 재무제표 기간 헤더에서 직접 읽은 연도가 표지 추정값보다 정확하다.
  // 연결/별도는 본문 언급이 아니라 실제 본표 제목으로 판정한 값이 정확하다.
  if (statements.basis && statements.basis !== meta.basis) {
    meta.basisFromText = meta.basis
    meta.basis = statements.basis
  }

  const resolvedYear = statements.periods?.[0]?.year ?? null
  if (resolvedYear && statements.periods[0].source === 'statement' && resolvedYear !== meta.fiscalYear) {
    meta.fiscalYearFromCover = meta.fiscalYear
    meta.fiscalYear = resolvedYear
    meta.fiscalYearSource = 'statement'
  } else {
    meta.fiscalYearSource = resolvedYear ? statements.periods[0].source : 'unknown'
  }

  onProgress?.(0.9, '주석 분리 중')
  const notes = parseNotes(doc)

  onProgress?.(0.95, '재무비율 계산 중')
  const ratios = computeRatios(statements.values)
  const insights = buildInsights(statements.values, ratios)
  const quality = scoreQuality(statements, narrative, meta)

  // 회사·연도·기간종류·연결여부로 결정되는 ID — 같은 보고서를 다시 올리면 갱신된다.
  return {
    id: reportIdOf(meta),
    companyKey: companyKeyOf(meta.company),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    meta,
    opinion: narrative.opinion,
    goingConcern: narrative.goingConcern,
    kam: narrative.kam,
    emphasis: narrative.emphasis,
    other: narrative.other,
    auditPartner: narrative.auditPartner,
    internalControl: narrative.internalControl,
    sections: narrative.sections,
    periods: statements.periods,
    values: statements.values,
    blocks: statements.blocks.map(serializeBlock),
    ratios,
    insights,
    quality,
    notes,
    stats: {
      rowCount: doc.rows.length,
      pageCount: doc.pageCount || null,
      charCount: doc.fullText.length,
      blockCount: statements.blocks.length,
      accountCount: Object.keys(statements.values).length,
    },
    rawText: doc.fullText,
  }
}

function serializeBlock(b) {
  return {
    id: b.id,
    stmt: b.stmt,
    basis: b.basis,
    label: b.label,
    headerText: b.headerText,
    page: b.page,
    unit: b.unit,
    unitFactor: b.unitFactor,
    matchCount: b.matchCount,
    periodHints: b.periodHints,
    items: Object.values(b.items).map((it) => ({
      key: it.key, label: it.label, rawLabel: it.rawLabel, level: it.level,
      values: it.values, scaled: it.scaled ?? null,
    })),
    rows: b.rows.map((r) => ({ label: r.label, values: r.values, scaled: r.scaled ?? null, kind: r.kind, page: r.page })),
  }
}

function scoreQuality(statements, narrative, meta) {
  const found = KEY_ACCOUNTS.filter((k) => statements.values[k] && statements.values[k].current != null)
  const warnings = []

  if (!statements.blocks.length) warnings.push('재무제표 표를 찾지 못했습니다. 텍스트 레이어가 없는 PDF일 수 있습니다.')
  if (narrative.opinion.type === 'unknown') warnings.push('감사의견 문단을 찾지 못했습니다. 재무제표만 담긴 파일일 수 있습니다.')
  if (!meta.fiscalYear) warnings.push('사업연도를 확정하지 못했습니다. 추이 그래프에서 연도축이 어긋날 수 있습니다.')
  if (found.length < 4) warnings.push('인식한 핵심 계정과목이 적습니다. 표 서식이 특이한 문서일 수 있습니다.')

  const balanceOk = checkBalance(statements.values)
  if (balanceOk === false) warnings.push('자산총계와 부채+자본총계가 일치하지 않습니다. 단위·열 인식 오류일 수 있습니다.')

  return {
    score: Math.round((found.length / KEY_ACCOUNTS.length) * 100),
    matched: found,
    missing: KEY_ACCOUNTS.filter((k) => !found.includes(k)),
    balanceOk,
    warnings,
  }
}

function checkBalance(v) {
  const a = v.totalAssets?.current
  const l = v.totalLiabilities?.current
  const e = v.totalEquity?.current
  if (a == null || l == null || e == null) return null
  const diff = Math.abs(a - (l + e))
  return diff <= Math.max(Math.abs(a) * 0.005, 10)
}
