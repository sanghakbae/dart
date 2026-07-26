// 「감사보고서 제출」 공시 서식.
//
// 상장사는 감사보고서 원문 대신 이 요약 서식을 공시한다. 재무상태표·손익계산서가
// 통째로 실리지 않아 일반 재무제표 파서가 아무것도 못 잡지만, 정작 필요한 수치는
// 다 들어 있다 — 감사의견, 자산·부채·자본, 매출·영업이익·당기순이익을 연결과 별도로
// 각각, 당해와 직전 두 해치.
//
//   [지배회사 또는 지주회사의 연결재무제표 기준 감사의견 및 재무요건]
//   구분              당해 사업연도    직전 사업연도
//   -감사의견          적정            적정
//   -자산총계          59,046,522,906  74,935,477,131
//   ...
//   [개별/별도재무제표 관련 감사의견 및 재무내용]
//   ...
//   2. 회계감사인명    삼화회계법인
//   3. 감사보고서 수령일자  2023-03-22

import { parseAmount } from './numbers.js'

const CONSOLIDATED_HEAD = /지배회사\s*또는\s*지주회사의\s*연결재무제표\s*기준|연결재무제표\s*기준\s*감사의견/
const SEPARATE_HEAD = /개별\s*\/?\s*별도재무제표\s*관련\s*감사의견/

/** 서식 라벨 → 앱의 계정 키 */
const ACCOUNTS = [
  [/^자산총계$/, 'totalAssets'],
  [/^부채총계$/, 'totalLiabilities'],
  [/^자본총계$/, 'totalEquity'],
  [/^자본금$/, 'capitalStock'],
  [/^매출액$/, 'revenue'],
  [/^영업이익$/, 'operatingProfit'],
  [/^법인세비용차감전계속사업이익$/, 'pretaxProfit'],
  [/^당기순이익$/, 'netIncome'],
  [/^지배기업\s*소유주지분\s*순이익$/, 'netIncomeControlling'],
]

/** 이 문서가 「감사보고서 제출」 서식인지 */
export function isSubmissionForm(text) {
  return /감사보고서\s*제출/.test(text.slice(0, 1500)) && SEPARATE_HEAD.test(text)
}

/**
 * @returns {null | {basis, values, sections, opinion, goingConcern, auditor, reportDate, fiscalYear, consolidatedCount}}
 */
export function parseSubmission(doc) {
  const text = doc.fullText
  if (!isSubmissionForm(text)) return null

  // 표 행을 그대로 훑는다. 각 행은 "라벨 | 당해 | 직전" 꼴이다.
  const rows = doc.rows.map((r) => (r.cells || []).map((c) => String(c).trim()))

  const zones = splitZones(rows)
  const consolidated = readZone(zones.consolidated)
  const separate = readZone(zones.separate)

  // 연결 수치가 있으면 연결을 대표로 쓴다(연결 제출 대상이면 그쪽이 주된 재무제표다).
  const primary = Object.keys(consolidated).length ? 'consolidated' : 'separate'
  const values = primary === 'consolidated' ? consolidated : separate
  if (!Object.keys(values).length) return null

  const auditor = findCell(rows, /^\d*\.?\s*회계감사인명$/)
  const reportDate = normalizeDate(findCell(rows, /^\d*\.?\s*감사보고서\s*수령일자$/))
  const opinionText = findCell(rows, /^-?\s*감사의견$/)
  const goingConcernText = findCell(rows, /계속기업\s*존속불확실성\s*사유\s*해당여부/)
  const internalControl = findCell(rows, /내부회계관리제도\s*검토의견\s*비적정\s*등\s*여부/)

  return {
    basis: primary === 'consolidated' ? '연결' : '별도',
    values,
    both: { 연결: consolidated, 별도: separate },
    auditor: auditor || null,
    reportDate,
    // 서식에 사업연도가 적히지 않는다. 감사보고서 수령일(보통 다음 해 3월)에서 역산한다.
    fiscalYear: reportDate ? Number(reportDate.slice(0, 4)) - 1 : null,
    opinion: opinionText || null,
    goingConcern: goingConcernText || null,
    internalControl: internalControl || null,
  }
}

/** 연결 구역과 별도 구역의 행 범위를 나눈다. */
function splitZones(rows) {
  let cStart = -1
  let sStart = -1
  rows.forEach((cells, i) => {
    const line = cells.join(' ')
    if (cStart < 0 && CONSOLIDATED_HEAD.test(line)) cStart = i
    if (sStart < 0 && SEPARATE_HEAD.test(line)) sStart = i
  })
  if (sStart < 0) return { consolidated: [], separate: [] }
  return {
    consolidated: cStart >= 0 && cStart < sStart ? rows.slice(cStart, sStart) : [],
    separate: rows.slice(sStart),
  }
}

/** 구역 안에서 계정 행을 읽어 { key: {current, prior} } 로 만든다. */
function readZone(zone) {
  const out = {}
  for (const cells of zone) {
    if (cells.length < 2) continue
    // 라벨에 단서가 붙는 해가 있다 — "매출액(금융업 영위 등 …영업수익을 포함)".
    // 괄호 안은 떼고 본 이름만 맞춘다. 서식이 조금씩 바뀌어도 라벨만 같으면 잡힌다.
    const label = cells[0]
      .replace(/^[-–·\s]+/, '')
      .replace(/[(（][^)）]*[)）]/g, '')
      .replace(/\s+/g, '')
    const hit = ACCOUNTS.find(([re]) => re.test(label))
    if (!hit) continue
    const nums = cells.slice(1).map(parseAmount).filter((v) => v != null)
    if (!nums.length) continue
    // 같은 라벨이 여러 번 나오면(자본잠식률 표 등) 먼저 나온 본표 값을 지킨다.
    if (out[hit[1]]) continue
    out[hit[1]] = { current: nums[0], prior: nums[1] ?? null }
  }
  return out
}

function findCell(rows, labelRe) {
  for (const cells of rows) {
    if (cells.length < 2) continue
    const label = cells[0].replace(/\s+/g, '')
    if (!labelRe.test(label)) continue
    const v = cells.slice(1).find((c) => c && c !== '-')
    if (v) return v
  }
  return null
}

function normalizeDate(s) {
  const m = /(20\d{2})\s*[-.년/]\s*(\d{1,2})\s*[-.월/]\s*(\d{1,2})/.exec(String(s || ''))
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null
}
