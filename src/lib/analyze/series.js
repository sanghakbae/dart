// 여러 보고서를 연도축으로 병합한다.
// 감사보고서 1개에도 당기·전기가 들어 있으므로 보고서 1건만으로도 2개년 추이가 만들어지고,
// 연도별 보고서를 여러 건 올리면 자동으로 다년 추이로 확장된다.

import { computeRatios, growth, ALL_RATIOS } from './ratios.js'

const PERIOD_ORDER = { FY: 4, Q3: 3, H1: 2, Q1: 1 }
const PERIOD_LABEL = { FY: '연간', Q3: '3분기', H1: '반기', Q1: '1분기' }

/**
 * 보고기간 종류별로 보고서를 나눈다.
 * 연간·반기·분기는 누적 기간이 달라 한 축에 섞으면 비교가 성립하지 않으므로,
 * 추이는 같은 종류끼리만 만든다. (상장회사는 분기·반기보고서를 함께 공시한다)
 */
export function splitByPeriodType(reports) {
  const map = new Map()
  for (const r of reports || []) {
    const type = r.meta?.periodType || 'FY'
    if (!map.has(type)) map.set(type, { type, label: PERIOD_LABEL[type] || type, order: PERIOD_ORDER[type] ?? 0, reports: [] })
    map.get(type).reports.push(r)
  }
  return [...map.values()].sort((a, b) => b.order - a.order)
}

/**
 * @param {Array} reports 저장된 보고서(요약) 목록 — 같은 보고기간 종류끼리 넘긴다
 * @param {{labelSuffix?: string}} [opts]
 * @returns {{ years:number[], byYear:Map, rows:Array, sources:Array }}
 */
export function buildTimeline(reports, opts = {}) {
  const suffix = opts.labelSuffix ? ` ${opts.labelSuffix}` : ''
  return buildTimelineInner(reports, suffix)
}

function buildTimelineInner(reports, suffix) {
  const byYear = new Map() // year → { year, values:{key:number}, ratios:{}, sources:[] }

  const upsert = (year, key, value, src, isCurrent) => {
    if (year == null || value == null) return
    if (!byYear.has(year)) byYear.set(year, { year, values: {}, sources: [] })
    const slot = byYear.get(year)
    const existing = slot.values[key]
    // 같은 연도가 여러 보고서에 나오면 '당기'로 실린 값을 우선한다(전기 비교치보다 정확).
    if (existing === undefined || (isCurrent && !slot.fromCurrent?.[key])) {
      slot.values[key] = value
      slot.fromCurrent = slot.fromCurrent || {}
      slot.fromCurrent[key] = isCurrent
    }
    if (!slot.sources.some((s) => s.id === src.id)) slot.sources.push(src)
  }

  for (const rep of reports) {
    const periods = rep.periods || rep.statements?.periods || []
    const values = rep.values || rep.statements?.values || {}
    const src = { id: rep.id, fileName: rep.meta?.fileName, company: rep.meta?.company, basis: rep.meta?.basis }
    const curYear = periods[0]?.year ?? rep.meta?.fiscalYear ?? null
    const priYear = periods[1]?.year ?? (curYear != null ? curYear - 1 : null)

    for (const [key, row] of Object.entries(values)) {
      if (!row || typeof row !== 'object') continue
      upsert(curYear, key, row.current, src, true)
      upsert(priYear, key, row.prior, src, false)
    }
  }

  const years = [...byYear.keys()].filter((y) => y != null).sort((a, b) => a - b)

  // 연도별 비율 계산 — computeRatios 는 current/prior 구조를 받으므로 감싸서 넘긴다.
  for (const y of years) {
    const slot = byYear.get(y)
    const wrapped = Object.fromEntries(Object.entries(slot.values).map(([k, v]) => [k, { current: v, prior: null }]))
    slot.ratios = computeRatios(wrapped).current
  }

  const rows = years.map((y) => {
    const slot = byYear.get(y)
    return { year: y, label: `${y}년${suffix}`, ...slot.values, __ratios: slot.ratios, __sources: slot.sources }
  })

  return { years, byYear, rows, sources: dedupeSources(reports) }
}

function dedupeSources(reports) {
  return reports.map((r) => ({
    id: r.id,
    company: r.meta?.company,
    fiscalYear: r.meta?.fiscalYear,
    basis: r.meta?.basis,
    fileName: r.meta?.fileName,
    createdAt: r.createdAt,
  }))
}

/** 추이 차트용 시리즈: 지정 계정들의 연도별 값 + 전년比 증감률 */
export function seriesFor(timeline, keys) {
  return timeline.rows.map((row, i) => {
    const prev = timeline.rows[i - 1]
    const out = { year: row.year, label: row.label }
    for (const k of keys) {
      out[k] = row[k] ?? null
      out[`${k}__growth`] = prev ? growth(row[k] ?? null, prev[k] ?? null) : null
    }
    return out
  })
}

/** 추이 차트용 비율 시리즈 */
export function ratioSeriesFor(timeline, ratioKeys) {
  return timeline.rows.map((row) => {
    const out = { year: row.year, label: row.label }
    for (const k of ratioKeys) out[k] = row.__ratios?.[k] ?? null
    return out
  })
}

export const RATIO_LABEL = Object.fromEntries(ALL_RATIOS.map((r) => [r.key, r.label]))
