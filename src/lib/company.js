// 회사 단위 누적 규칙.
//
// DB는 회사 문서 하나에 그 회사의 모든 보고기간을 누적한다.
//   companies/{companyKey}                        누적 요약 (연도별 값 · 최신 감사의견)
//   companies/{companyKey}/reports/{reportId}     보고서별 분석 결과
//   companies/{companyKey}/reports/{reportId}/content/*   원문 · 표 · 주석 청크
//
// reportId 는 회사·연도·기간종류·연결여부로 결정되므로, 같은 보고서를 다시 올리면
// 새 문서가 생기지 않고 기존 것을 갱신한다(= 중복 없이 누적된다).

// 연결재무제표 표제는 "○○주식회사와 그 종속기업" 으로 나온다.
// 이걸 떼지 않으면 같은 회사의 연결·별도 보고서가 서로 다른 회사로 갈린다.
export const SUBSIDIARY_PHRASE =
  /\s*(?:와|과|및|그리고)?\s*그?\s*(?:연결)?\s*종속\s*(?:기업|회사)\s*(?:들)?\s*|and\s+its\s+subsidiar(?:y|ies)/gi

const CORP_FORM = /주식회사|유한책임회사|유한회사|합자회사|합명회사|㈜|㈲|\(주\)|\(유\)/g
const CORP_FORM_EN = /(?:co|ltd|inc|corp|corporation|company|limited)\.?/gi

/** 표기가 달라도 같은 회사로 묶기 위한 정규화 */
export function normalizeCompany(name) {
  return String(name || '')
    .replace(SUBSIDIARY_PHRASE, '')
    .replace(CORP_FORM, '')
    .replace(CORP_FORM_EN, '')
    .replace(/[^가-힣a-zA-Z0-9]/g, '')
    .toLowerCase()
}

/** 화면에 보여줄 회사명 — 종속기업 수식어와 앞뒤 군더더기를 떼어낸다 */
export function displayCompany(name) {
  const clean = String(name || '')
    .replace(SUBSIDIARY_PHRASE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean || String(name || '').trim()
}

/** Firestore 문서 ID 로 쓸 수 있게 다듬는다 (슬래시·예약 패턴 제거) */
export function companyKeyOf(name) {
  const norm = normalizeCompany(name)
    .replace(/[^가-힣a-z0-9]/g, '')
    .slice(0, 60)
  if (norm && !/^__.*__$/.test(norm)) return norm
  // 한글·영문이 하나도 없는 이름은 해시로 대체한다.
  let h = 0
  for (const ch of String(name || 'unknown')) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return `co${h.toString(36)}`
}

const BASIS_CODE = (basis) => (basis === '연결' ? 'c' : 's')

/** 같은 회사 안에서 보고서를 식별하는 결정적 ID */
export function reportIdOf(meta) {
  const year = meta?.fiscalYear || 'na'
  const type = meta?.periodType || 'FY'
  return `${year}-${type}-${BASIS_CODE(meta?.basis)}`
}

/**
 * 누적 키 = 기간종류 + 연도 + 연결여부.
 * 연간과 분기가 서로를 덮지 않아야 하고, 같은 연도의 연결·별도도 수치가 달라
 * 서로 덮으면 안 된다(연결은 종속회사까지 합산한 값이다).
 */
export function periodKeyOf(year, periodType = 'FY', basis = '별도') {
  return `${periodType}-${year}-${BASIS_CODE(basis)}`
}

/**
 * 보고서 하나에서 회사 문서에 누적할 항목들을 뽑는다.
 * 감사보고서에는 당기와 전기가 함께 실리므로 두 기간을 모두 누적하고,
 * 전기 비교치로 들어온 값은 fromPrior 로 표시해 나중에 그 연도를 당기로 보고한
 * 보고서가 올라오면 덮어쓸 수 있게 한다.
 */
export function periodEntriesOf(report) {
  const meta = report.meta || {}
  const periods = report.periods || []
  const values = report.values || {}
  const type = meta.periodType || 'FY'
  const reportId = reportIdOf(meta)

  const years = [periods[0]?.year ?? meta.fiscalYear ?? null, periods[1]?.year ?? null]
  if (years[1] == null && years[0] != null) years[1] = years[0] - 1

  const out = {}
  years.forEach((year, idx) => {
    if (year == null) return
    const slot = {}
    for (const [key, row] of Object.entries(values)) {
      const v = idx === 0 ? row?.current : row?.prior
      if (v != null) slot[key] = v
    }
    if (!Object.keys(slot).length) return

    out[periodKeyOf(year, type, meta.basis)] = {
      year,
      periodType: type,
      periodLabel: meta.periodLabel || '연간',
      basis: meta.basis || '별도',
      reportId,
      fromPrior: idx === 1,
      values: slot,
      opinion: idx === 0 ? report.opinion || null : null,
      auditor: idx === 0 ? meta.auditor || null : null,
      docKind: idx === 0 ? meta.docKind || null : null,
      updatedAt: report.createdAt || Date.now(),
    }
  })
  return out
}

/**
 * 기존 회사 문서에 새 보고서를 누적한다. 순수 함수라 테스트로 검증할 수 있다.
 * @param {object|null} prev 기존 회사 문서 (없으면 null)
 * @param {object} report 새로 분석한 보고서
 */
export function accumulateCompany(prev, report) {
  const meta = report.meta || {}
  const key = companyKeyOf(meta.company)
  const now = report.createdAt || Date.now()
  const base = prev || { key, createdAt: now, periods: {}, aliases: [], reportIds: [] }

  const periods = { ...(base.periods || {}) }
  for (const [pk, entry] of Object.entries(periodEntriesOf(report))) {
    const old = periods[pk]
    // 당기로 보고된 값이 전기 비교치보다 정확하다. 전기 값으로 당기 값을 덮지 않는다.
    if (old && !old.fromPrior && entry.fromPrior) {
      periods[pk] = { ...old, values: { ...entry.values, ...old.values } }
      continue
    }
    periods[pk] = old ? { ...old, ...entry, values: { ...old.values, ...entry.values } } : entry
  }

  const aliases = [...new Set([...(base.aliases || []), meta.company].filter(Boolean))]
  const reportIds = [...new Set([...(base.reportIds || []), reportIdOf(meta)])]

  // 최신 보고서는 사업연도 → 기간종류 → 업로드시각 순으로 판단한다.
  const PERIOD_RANK = { FY: 4, Q3: 3, H1: 2, Q1: 1 }
  const candidate = {
    reportId: reportIdOf(meta),
    company: meta.company,
    fiscalYear: meta.fiscalYear ?? null,
    periodType: meta.periodType || 'FY',
    periodLabel: meta.periodLabel || '연간',
    basis: meta.basis || '별도',
    docKind: meta.docKind || null,
    auditor: meta.auditor || null,
    opinion: report.opinion || null,
    fileName: meta.fileName || null,
    uploadedAt: now,
  }
  const better = (a, b) => {
    if (!b) return true
    if ((a.fiscalYear ?? -1) !== (b.fiscalYear ?? -1)) return (a.fiscalYear ?? -1) > (b.fiscalYear ?? -1)
    const ra = PERIOD_RANK[a.periodType] ?? 0
    const rb = PERIOD_RANK[b.periodType] ?? 0
    if (ra !== rb) return ra > rb
    return (a.uploadedAt || 0) >= (b.uploadedAt || 0)
  }

  return {
    ...base,
    key,
    name: displayCompany(meta.company) || base.name || key,
    aliases,
    periods,
    reportIds,
    reportCount: reportIds.length,
    latest: better(candidate, base.latest) ? candidate : base.latest,
    updatedAt: Math.max(now, base.updatedAt || 0),
  }
}

/**
 * 회사 문서 → 리스트·스파크라인용 파생값.
 * 추이는 기준을 섞지 않는다: 최신 보고서의 연결/별도 기준을 따르고, 그 안에서
 * 가장 포괄적인 보고기간 종류(연간 우선)만 골라 한 축에 올린다.
 */
export function companyView(doc) {
  const all = Object.values(doc.periods || {})
  const types = [...new Set(all.map((p) => p.periodType))]
  const bases = [...new Set(all.map((p) => p.basis).filter(Boolean))]
  const PERIOD_RANK = { FY: 4, Q3: 3, H1: 2, Q1: 1 }

  // 가장 포괄적인 보고기간 종류(연간 우선)를 먼저 고른다.
  const primaryType = [...types].sort((a, b) => (PERIOD_RANK[b] ?? 0) - (PERIOD_RANK[a] ?? 0))[0] || 'FY'
  const ofType = all.filter((p) => p.periodType === primaryType)

  // 그 종류 안에서 연도가 가장 많이 쌓인 기준(연결/별도)을 쓴다 — 추이가 길어야 쓸모 있고,
  // 기준을 섞으면 합산 범위가 달라 비교가 성립하지 않는다. 동수면 최신 보고서 기준을 따른다.
  const countByBasis = new Map()
  for (const p of ofType) {
    const b = p.basis || '별도'
    countByBasis.set(b, (countByBasis.get(b) || 0) + 1)
  }
  const latestBasis = doc.latest?.basis || null
  const preferredBasis =
    [...countByBasis.entries()].sort(
      (a, b) => b[1] - a[1] || (a[0] === latestBasis ? -1 : b[0] === latestBasis ? 1 : 0)
    )[0]?.[0] || latestBasis || '별도'

  const primary = ofType.filter((p) => (p.basis || '별도') === preferredBasis).sort((a, b) => a.year - b.year)

  const trend = primary
    .map((p) => ({ label: `${p.year}년${primaryType === 'FY' ? '' : ` ${p.periodLabel}`}`, value: p.values?.revenue ?? null }))
    .filter((p) => p.value != null)

  return {
    key: doc.key,
    name: doc.name,
    bases,
    trendBasis: preferredBasis,
    latest: doc.latest || null,
    opinion: doc.latest?.opinion || null,
    basis: doc.latest?.basis || null,
    auditor: doc.latest?.auditor || null,
    docKind: doc.latest?.docKind || null,
    reportCount: doc.reportCount || (doc.reportIds || []).length,
    uploadedAt: doc.updatedAt || 0,
    years: [...new Set(all.map((p) => p.year))].sort((a, b) => a - b),
    periodTypes: types,
    primaryType,
    primaryLabel: primary[0]?.periodLabel || '연간',
    trend,
    storage: doc.storage || 'local',
  }
}
