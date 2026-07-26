import { extractDocument } from '../extract/index.js'
import { parseMeta } from './meta.js'
import { parseNarrative } from './opinion.js'
import { parseStatements } from './statements.js'
import { parseNotes } from './notes.js'
import { parseShares } from './shares.js'
import { parseSubmission } from './submission.js'
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

  // 상장사는 감사보고서 원문 대신 「감사보고서 제출」 요약 서식을 공시한다.
  // 재무제표 본표가 없어 위 파서는 아무것도 못 잡지만 서식 안에 수치가 다 있다.
  const submission = statements.blocks.length ? null : parseSubmission(doc)
  if (submission) applySubmission({ meta, narrative, statements }, submission)

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

  onProgress?.(0.93, '주주·주식 정보 정리 중')
  const shares = parseShares(doc, notes)

  onProgress?.(0.95, '재무비율 계산 중')
  const ratios = computeRatios(statements.values)
  const insights = buildInsights(statements.values, ratios)
  const quality = scoreQuality(statements, narrative, meta, doc)

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
    shares,
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

const OPINION_TONE = {
  적정: { type: 'unqualified', label: '적정의견', tone: 'good' },
  한정: { type: 'qualified', label: '한정의견', tone: 'warn' },
  부적정: { type: 'adverse', label: '부적정의견', tone: 'critical' },
  '의견거절': { type: 'disclaimer', label: '의견거절', tone: 'critical' },
}

const SUBMISSION_LABELS = {
  totalAssets: '자산총계', totalLiabilities: '부채총계', totalEquity: '자본총계',
  capitalStock: '자본금', revenue: '매출액', operatingProfit: '영업이익',
  pretaxProfit: '법인세비용차감전계속사업이익', netIncome: '당기순이익',
  netIncomeControlling: '지배기업 소유주지분 순이익',
}

/**
 * 「감사보고서 제출」 서식에서 읽은 값을 일반 파싱 결과 자리에 끼워 넣는다.
 * 이후 단계(비율·추이·점검)는 출처를 구분하지 않고 그대로 쓴다.
 */
function applySubmission(ctx, sub) {
  const { meta, narrative, statements } = ctx

  meta.docKind = '감사보고서 제출'
  meta.isSubmissionForm = true
  if (sub.basis) meta.basis = sub.basis
  if (sub.auditor) meta.auditor = sub.auditor
  if (sub.reportDate) meta.reportDate = sub.reportDate
  if (sub.fiscalYear) {
    meta.fiscalYear = sub.fiscalYear
    meta.fiscalYearSource = 'submission'
  }

  statements.values = sub.values
  statements.basis = sub.basis
  statements.periods = [
    { id: 'current', year: sub.fiscalYear ?? null, label: sub.fiscalYear ? `${sub.fiscalYear}년` : '당해', which: '당기', source: 'submission' },
    { id: 'prior', year: sub.fiscalYear ? sub.fiscalYear - 1 : null, label: sub.fiscalYear ? `${sub.fiscalYear - 1}년` : '직전', which: '전기', source: 'submission' },
  ]

  // 연결·별도를 각각 표로 만들어 재무제표 탭에서 그대로 볼 수 있게 한다.
  statements.blocks = Object.entries(sub.both)
    .filter(([, v]) => Object.keys(v).length)
    .map(([basis, v]) => ({
      id: `submission-${basis}`,
      stmt: 'summary',
      basis,
      label: `${basis} 요약 (감사보고서 제출 서식)`,
      headerText: `${basis}재무제표 기준 주요 재무내용`,
      page: 1,
      unit: '원',
      unitFactor: 1,
      matchCount: Object.keys(v).length,
      periodHints: [],
      items: Object.entries(v).map(([key, cell]) => ({
        key, label: SUBMISSION_LABELS[key] || key, rawLabel: SUBMISSION_LABELS[key] || key,
        level: 0, values: [cell.current, cell.prior], scaled: null,
      })),
      rows: Object.entries(v).map(([key, cell]) => ({
        label: SUBMISSION_LABELS[key] || key, values: [cell.current, cell.prior], scaled: null, kind: 'item', page: 1,
      })),
    }))

  const op = OPINION_TONE[String(sub.opinion || '').replace(/\s+/g, '')]
  if (op && narrative.opinion?.type === 'unknown') {
    narrative.opinion = { ...narrative.opinion, ...op, source: 'submission' }
  }
  if (sub.goingConcern && narrative.goingConcern) {
    narrative.goingConcern.flagged = !/미해당|해당없음/.test(sub.goingConcern)
    narrative.goingConcern.text = narrative.goingConcern.text || `계속기업 존속불확실성 사유 해당여부: ${sub.goingConcern}`
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

function scoreQuality(statements, narrative, meta, doc) {
  const found = KEY_ACCOUNTS.filter((k) => statements.values[k] && statements.values[k].current != null)
  const warnings = []

  if (!statements.blocks.length) warnings.push(noStatementReason(doc))
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

/**
 * 재무제표를 못 찾았을 때 "왜"를 알려 준다.
 * 같은 증상이라도 원인이 전혀 다르다 — 표가 아예 없는 파일인지, 표는 있는데
 * 서식을 못 읽은 건지에 따라 사용자가 할 일이 달라진다.
 */
function noStatementReason(doc) {
  const tableRows = (doc?.rows || []).filter((r) => r.fromTable).length
  const chars = doc?.fullText?.length || 0
  const stat = `표 행 ${tableRows.toLocaleString('ko-KR')}개 · 본문 ${chars.toLocaleString('ko-KR')}자`

  if (doc?.kind === 'html' && tableRows === 0) {
    return (
      `재무제표 표를 찾지 못했습니다 (${stat}). 이 HTML 에는 표가 하나도 없습니다 — ` +
      'DART 뷰어 화면을 브라우저로 저장하면 본문이 iframe 안에 있어 껍데기만 저장됩니다. ' +
      "뷰어 우측 상단의 '다운로드' 로 받은 원본 파일을 올려주세요."
    )
  }
  if (tableRows === 0) {
    return (
      `재무제표 표를 찾지 못했습니다 (${stat}). 표 구조가 하나도 인식되지 않았습니다 — ` +
      '스캔 이미지로 만든 PDF이거나 표가 그림으로 들어 있는 문서일 수 있습니다.'
    )
  }
  return (
    `재무제표 표를 찾지 못했습니다 (${stat}). 표는 읽었지만 재무상태표·손익계산서 서식으로 ` +
    '인식되지 않았습니다. 재무제표가 빠진 문서이거나 서식이 특이한 경우입니다.'
  )
}

function checkBalance(v) {
  const a = v.totalAssets?.current
  const l = v.totalLiabilities?.current
  const e = v.totalEquity?.current
  if (a == null || l == null || e == null) return null
  const diff = Math.abs(a - (l + e))
  return diff <= Math.max(Math.abs(a) * 0.005, 10)
}
