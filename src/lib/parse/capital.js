// 자본금 주석과 주식선택권 주석.
//
// 자본금 주석의 발행주식수는 '보통주' 만이다. 상환전환우선주는 부채라 여기 없다
// (무하유: 자본금 주석 4,000,000주, 등기부 4,685,800주). 그래서 이 파서가 주는
// issuedShares 는 언제나 보통주 수로 다뤄야 한다 — 총 주식수는 rcps.js 와 합쳐 만든다.
//
// 자본금 변동 내역도 여기 있다. 무상증자와 액면분할은 겉보기에 똑같이 '주식수가
// N배로 늘었다' 지만 성격이 전혀 다르다 — 무상증자는 잉여금을 자본금으로 옮기므로
// 자본금이 함께 늘고, 액면분할은 액면가만 쪼개므로 자본금이 그대로다.
// 둘을 뭉쳐 "200배 늘었다" 로만 보여주면 읽는 사람이 잘못 이해한다.

import { parseAmount } from './numbers.js'
import { noteZone, normLabel } from './zone.js'

const CAPITAL_HEAD = /^\d{1,2}\s*\.\s*자본금/
const OPTION_HEAD = /^\d{1,2}\s*\.\s*(주식기준보상|주식선택권|주식매수선택권)/

const SUMMARY = [
  [/^수권주식수/, 'authorizedShares', 'shares'],
  [/^발행주식수/, 'issuedShares', 'shares'],
  [/^1주당금액|^액면가|^주당액면/, 'parValue', 'amount'],
  [/^(보통주)?자본금$/, 'capitalStock', 'amount'],
]

/** 변동 사유. 자본금이 함께 움직이는지가 무상증자와 액면분할을 가른다. */
const EVENTS = [
  [/무상증자/, 'bonus', '무상증자'],
  [/액면분할/, 'split', '액면분할'],
  [/액면병합/, 'reverseSplit', '액면병합'],
  [/유상증자/, 'paidIn', '유상증자'],
  [/주식배당/, 'stockDividend', '주식배당'],
  [/전환(권)?행사|전환청구/, 'conversion', '전환권 행사'],
  [/주식선택권행사|스톡옵션행사/, 'optionExercise', '주식선택권 행사'],
]

/** 잔액 행 — 사건이 아니다. */
const BALANCE_ROW = /^(전기초|전기말|당기초|당기말|기초|기말|합계|소계)$/

/**
 * @param {{rows: {cells:string[]}[]}} doc
 * @returns {null|object}
 */
export function parseCapital(doc) {
  const rows = (doc?.rows || []).map((r) => (r.cells || []).map((c) => String(c).trim()))
  const zone = noteZone(rows, CAPITAL_HEAD)
  if (!zone) return null

  const summary = readSummary(zone)
  const changes = readChanges(zone)
  if (!summary && !changes.length) return null

  return {
    found: true,
    ...summary,
    changes,
    stockOptions: parseStockOptions(rows),
  }
}

function readSummary(zone) {
  const out = {}
  const prior = {}
  for (const cells of zone) {
    if (cells.length < 2) continue
    const label = normLabel(cells[0])
    const hit = SUMMARY.find(([re]) => re.test(label))
    if (!hit || out[hit[1]] != null) continue
    const nums = cells.slice(1).map((c) => parseAmount(String(c).replace(/주/g, ''))).filter((v) => v != null)
    if (!nums.length) continue
    out[hit[1]] = nums[0]
    if (nums[1] != null) prior[hit[1]] = nums[1]
  }
  if (!Object.keys(out).length) return null
  out.priorPeriod = Object.keys(prior).length ? prior : null
  return out
}

/**
 * 자본금 변동 내역. 사유별로 주식수와 자본금 변동을 함께 담는다.
 * 자본금이 움직이지 않은 주식수 증가는 액면분할이다 — 라벨이 없어도 그걸로 갈린다.
 */
function readChanges(zone) {
  const out = []
  for (const cells of zone) {
    if (cells.length < 2) continue
    const label = normLabel(cells[0])
    if (BALANCE_ROW.test(label)) continue
    const hit = EVENTS.find(([re]) => re.test(label))
    if (!hit) continue

    const shares = parseAmount(String(cells[1] || '').replace(/주/g, ''))
    const capital = cells[2] != null ? parseAmount(cells[2]) : null
    if (shares == null && capital == null) continue
    out.push({
      kind: hit[1],
      label: hit[2],
      shares,
      capital,
      // 자본금이 함께 늘면 잉여금 자본전입(무상증자), 그대로면 액면 쪼개기다.
      capitalMoved: capital != null && capital !== 0,
    })
  }
  return out
}

/**
 * 주식선택권 — 완전희석 주식수에 들어간다.
 * 행사가능주식수가 있으면 그쪽이 정확하다(부여분 중 소멸한 게 빠져 있다).
 */
export function parseStockOptions(rows) {
  const zone = noteZone(rows, OPTION_HEAD)
  if (!zone) return null

  let cols = null
  const grants = []
  for (const cells of zone) {
    if (cells.length < 3) continue
    const label = normLabel(cells[0])

    if (!cols && /^구분$/.test(label) && /주식수/.test(cells.join(''))) {
      cols = cells.map(normLabel)
      continue
    }
    // "1차", "2차" 처럼 회차 행만 읽는다.
    if (!/^\d+차$/.test(label)) continue

    const at = (re) => {
      const i = cols?.findIndex((c) => re.test(c)) ?? -1
      return i > 0 ? cells[i] : null
    }
    const granted = parseAmount(String(at(/^발행주식수/) ?? cells[1]).replace(/주/g, ''))
    const exercisable = parseAmount(String(at(/^행사가능주식수/) ?? cells[2] ?? '').replace(/주/g, ''))
    if (granted == null && exercisable == null) continue
    grants.push({
      round: cells[0].trim(),
      granted,
      exercisable,
      grantDate: at(/^부여일/),
      strike: parseAmount(at(/^행사가격/)),
    })
  }
  if (!grants.length) return null

  const total = grants.reduce((a, g) => a + (g.exercisable ?? g.granted ?? 0), 0)
  return { grants, potentialShares: total || null }
}
