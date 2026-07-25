// 여러 보고서를 연도축으로 병합한다.
// 감사보고서 1개에도 당기·전기가 들어 있으므로 보고서 1건만으로도 2개년 추이가 만들어지고,
// 연도별 보고서를 여러 건 올리면 자동으로 다년 추이로 확장된다.

import { computeRatios, growth, ALL_RATIOS } from './ratios.js'

/**
 * @param {Array} reports 저장된 보고서(요약) 목록
 * @returns {{ years:number[], byYear:Map, rows:Array, sources:Array }}
 */
export function buildTimeline(reports) {
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
    return { year: y, label: `${y}년`, ...slot.values, __ratios: slot.ratios, __sources: slot.sources }
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
