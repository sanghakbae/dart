// 자본조달 공시 파서.
//
// DART 의 「유상증자결정」·「전환사채권발행결정」·「증권발행결과」는 정형 서식이라
// 라벨만 맞추면 금액·주식수·발행가를 그대로 읽을 수 있다. 서식이 조금씩 달라도
// 항목 번호나 순서에 기대지 않으므로 해가 바뀌어도 잡힌다.
//
// 두 가지가 발목을 잡았다.
//  1. 라벨이 항상 첫 칸에 있지 않다. 「증권발행결과」는 큰 항목이 첫 칸,
//     실제 라벨은 둘째 칸이다 — "3. 발행내역 | 발행예정금액(원) | 2,500,000,000".
//     그래서 칸마다 라벨 후보로 보고, 맞은 칸의 오른쪽에서 값을 찾는다.
//  2. 라벨에 단위가 붙는다 — "사채의 권면(전자등록)총액 (원)". 괄호는 떼고 맞춘다.
//
// 제3자배정 대상자(투자자 이름)는 이 서식에 없다. 증권신고서나 사업보고서를 봐야 한다.

import { parseAmount } from './numbers.js'

const FIELDS = [
  { key: 'newShares', re: /^신주의종류와수$|^발행예정주식수$|^실제발행주식수$|^전환에따라발행할주식$/, kind: 'shares' },
  { key: 'parValue', re: /^1주당액면가액$/, kind: 'money' },
  { key: 'sharesBefore', re: /^증자전발행주식총수$|^현재발행주식총수$/, kind: 'shares' },
  { key: 'issuePrice', re: /^신주발행가액$|^전환가액$|^행사가액$|^교환가액$/, kind: 'money' },
  { key: 'basePrice', re: /^기준주가$/, kind: 'money' },
  { key: 'discount', re: /기준주가에대한할인율|할인율또는할증율|할인율할증률/, kind: 'pct' },
  { key: 'faceAmount', re: /^사채의권면총액$|^사채의권면전자등록총액$|^발행예정금액$|^실제발행금액$/, kind: 'money' },
  { key: 'couponRate', re: /^표면이자율$/, kind: 'pct' },
  { key: 'ytmRate', re: /^만기이자율$/, kind: 'pct' },
  { key: 'maturityDate', re: /^사채만기일$/, kind: 'date' },
  { key: 'payDate', re: /^납입일$/, kind: 'date' },
  { key: 'boardDate', re: /^이사회결의일결정일$|^이사회결의일$|^발행결정최초이사회결의일$/, kind: 'date' },
  { key: 'method', re: /^증자방식$|^발행방법$/, kind: 'text' },
  { key: 'securityType', re: /^사채의종류$|^증권의종류$/, kind: 'text' },
]

const PURPOSES = [
  ['시설자금', 'facility'],
  ['영업양수자금', 'acquisition'],
  ['운영자금', 'operating'],
  ['채무상환자금', 'debtRepay'],
  ['타법인증권취득자금', 'securities'],
  ['기타자금', 'etc'],
]

/** 라벨 정규화 — 항목 번호·괄호 단위·공백을 떼고 본 이름만 남긴다. */
function normLabel(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/^[※▶◦·\-]+/, '')
    .replace(/^\d{1,2}(-\d)?\./, '')
    .replace(/[(（][^)）]*[)）]/g, '')
}

/** 이 문서가 자본조달 공시인지 */
export function isFundingForm(text) {
  const head = text.slice(0, 3000)
  return /유상증자\s*결정|무상증자\s*결정|전환사채권\s*발행결정|신주인수권부사채권\s*발행결정|교환사채권\s*발행결정|증권\s*발행결과/.test(
    head
  )
}

/**
 * @returns {null | {kind, fields, purposes, totalRaised, purposeSum}}
 */
export function parseFunding(doc) {
  const text = doc.fullText
  if (!isFundingForm(text)) return null

  const rows = doc.rows.map((r) => (r.cells || []).map((c) => String(c).trim()).filter(Boolean))

  const fields = {}
  const purposes = {}

  for (const cells of rows) {
    if (cells.length < 2) continue

    // 자금 용도. 먼저 나온 본표 값을 지킨다 — 뒤쪽 안내 문단에도 같은 낱말이 섞여 있다.
    for (const [name, key] of PURPOSES) {
      if (purposes[key]) continue
      const at = cells.findIndex((c) => normLabel(c) === name)
      if (at < 0) continue
      const v = cells.slice(at + 1).map(parseAmount).find((n) => n != null)
      if (v != null && v > 0) purposes[key] = { label: name, amount: v }
    }

    // 라벨이 몇 번째 칸에 있든 찾는다.
    for (let i = 0; i < cells.length - 1; i++) {
      const label = normLabel(cells[i])
      if (!label) continue
      for (const f of FIELDS) {
        if (fields[f.key] != null) continue
        if (!f.re.test(label)) continue
        const rest = cells.slice(i + 1)
        const v = readCell(rest, f.kind)
        if (v != null) fields[f.key] = v
      }
    }
  }

  if (!Object.keys(fields).length && !Object.keys(purposes).length) return null

  const purposeSum = Object.values(purposes).reduce((a, p) => a + p.amount, 0)
  // 조달 총액: 사채는 권면총액, 증자는 발행가 × 주식수, 둘 다 없으면 용도 합계.
  const byShares =
    fields.issuePrice != null && fields.newShares != null ? fields.issuePrice * fields.newShares : null
  const totalRaised = fields.faceAmount ?? byShares ?? (purposeSum || null)

  return { kind: formKind(text, fields), fields, purposes, purposeSum: purposeSum || null, totalRaised }
}

function readCell(rest, kind) {
  if (kind === 'text') {
    // "1. 사채의 종류 | 회차 | 4 | 종류 | 무기명식 … 전환사채" 처럼
    // 값 앞에 또 다른 라벨이 끼어든다. 라벨스러운 낱말은 건너뛴다.
    const v = rest.find(
      (c) => c && c !== '-' && !/^[\d,.\s%원주]+$/.test(c) && !/^(회차|종류|구분|비고)$/.test(c.replace(/\s+/g, ''))
    )
    return v || null
  }
  if (kind === 'date') {
    for (const c of rest) {
      const d = toDate(c)
      if (d) return d
    }
    return null
  }
  // 숫자 — '-' 는 값 없음이다. 0 은 유효한 값이라(표면이자율 0.0%) null 과 구분한다.
  for (const c of rest) {
    if (!c || c === '-') continue
    const n = parseAmount(c)
    if (n != null) return n
  }
  return null
}

function formKind(text, fields) {
  const head = text.slice(0, 3000)
  const type = fields.securityType || ''
  if (/증권\s*발행결과/.test(head)) {
    // 발행결과는 제목만으로 종류를 모른다 — 증권의 종류에서 읽는다.
    if (/전환사채/.test(type)) return 'CB'
    if (/신주인수권부사채/.test(type)) return 'BW'
    if (/교환사채/.test(type)) return 'EB'
    if (/우선주/.test(type)) return '우선주 증자'
    return '유상증자'
  }
  if (/전환사채권/.test(head)) return 'CB'
  if (/신주인수권부사채권/.test(head)) return 'BW'
  if (/교환사채권/.test(head)) return 'EB'
  if (/무상증자/.test(head)) return '무상증자'
  if (/유상증자/.test(head)) return '유상증자'
  return '기타'
}

function toDate(s) {
  const m = /(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/.exec(String(s || ''))
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : null
}
