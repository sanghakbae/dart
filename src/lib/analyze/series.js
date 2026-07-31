// 여러 보고서를 연도축으로 병합한다.
// 감사보고서 1개에도 당기·전기가 들어 있으므로 보고서 1건만으로도 2개년 추이가 만들어지고,
// 연도별 보고서를 여러 건 올리면 자동으로 다년 추이로 확장된다.

import { computeRatios, growth, ALL_RATIOS } from './ratios.js'
import { valuesByBasisOf } from '../company.js'

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
 * 이 보고서에 그 기준의 수치가 실려 있는가.
 * 사업보고서는 연결과 별도를 함께 싣는다 — 문서 라벨이 '연결' 이어도
 * 별도 본표가 그 안에 있으면 별도 추이에 넣어야 한다.
 */
export function hasBasis(report, basis) {
  if (!basis) return true
  return Boolean(valuesByBasisOf(report)[basis])
}

/**
 * @param {Array} reports 저장된 보고서(요약) 목록 — 같은 보고기간 종류끼리 넘긴다
 * @param {{labelSuffix?: string, basis?: string}} [opts]
 * @returns {{ years:number[], byYear:Map, rows:Array, sources:Array }}
 */
export function buildTimeline(reports, opts = {}) {
  const suffix = opts.labelSuffix ? ` ${opts.labelSuffix}` : ''
  return buildTimelineInner(reports, suffix, opts.basis || null)
}

function buildTimelineInner(reports, suffix, basis) {
  const byYear = new Map() // year → { year, values:{key:number}, ratios:{}, sources:[] }

  const upsert = (year, key, value, src, isCurrent) => {
    if (year == null || value == null) return
    if (!byYear.has(year)) byYear.set(year, { year, values: {}, sources: [], meta: {} })
    const slot = byYear.get(year)
    const prev = slot.meta[key]
    // 같은 연도가 여러 보고서에 나오면 더 나중 보고서의 값을 쓴다.
    // 회계기준 변경·오류수정으로 과거 수치가 재작성되면 나중 보고서의 비교치가 맞다.
    // 같은 보고서 연도면 '당기'로 실린 값이 '전기' 비교치보다 정확하다.
    const srcYear = src.fiscalYear ?? -1
    const take =
      !prev || srcYear > prev.srcYear || (srcYear === prev.srcYear && isCurrent && !prev.isCurrent)
    if (take) {
      if (prev && prev.value !== value && srcYear !== prev.srcYear) slot.restated = true
      slot.values[key] = value
      slot.meta[key] = { srcYear, isCurrent, value }
    }
    if (!slot.sources.some((s) => s.id === src.id)) slot.sources.push(src)
  }

  for (const rep of reports) {
    const periods = rep.periods || rep.statements?.periods || []
    const byBasis = valuesByBasisOf(rep)
    // 기준을 고르면 그 기준의 수치만 쓴다. 없으면 이 보고서는 그 축에 아무것도 못 준다.
    const values = basis ? byBasis[basis] : rep.values || rep.statements?.values || {}
    if (!values) continue
    const src = {
      id: rep.id,
      fileName: rep.meta?.fileName,
      company: rep.meta?.company,
      basis: basis || rep.meta?.basis,
      fiscalYear: rep.meta?.fiscalYear ?? null,
    }
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
    return {
      year: y,
      label: `${y}년${suffix}`,
      ...slot.values,
      __ratios: slot.ratios,
      __sources: slot.sources,
      __restated: Boolean(slot.restated),
    }
  })

  return { years, byYear, rows, sources: dedupeSources(reports.filter((r) => hasBasis(r, basis)), basis) }
}

function dedupeSources(reports, basis) {
  return reports.map((r) => ({
    id: r.id,
    company: r.meta?.company,
    fiscalYear: r.meta?.fiscalYear,
    basis: basis || r.meta?.basis,
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
