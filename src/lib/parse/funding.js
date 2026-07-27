// 자본조달 공시 파서.
//
// DART 의 「유상증자결정」·「전환사채권발행결정」·「증권발행결과」는 정형 서식이라
// 라벨만 맞추면 금액·주식수·발행가를 그대로 읽을 수 있다.
//
//   1. 신주의 종류와 수   보통주식 (주)   486,618
//   4. 자금조달의 목적     운영자금 (원)   999,999,990
//   6. 신주 발행가액       보통주식 (원)   2,055
//   9. 납입일             2026년 05월 21일
//
// 서식이 조금씩 달라도 라벨 기준이라 항목 순서·번호가 바뀌어도 잡힌다.
// 제3자배정 대상자(투자자 이름)는 이 서식에 없다 — 증권신고서나 사업보고서를 봐야 한다.

import { parseAmount } from './numbers.js'

const FIELDS = [
  { key: 'newShares', re: /^1?\.?신주의종류와수?$|^신주의종류와수$|^발행예정주식수$|^실제발행주식수$/, kind: 'shares' },
  { key: 'parValue', re: /^\d?\.?1주당액면가액$/, kind: 'money' },
  { key: 'sharesBefore', re: /^\d?\.?증자전발행주식총수$/, kind: 'shares' },
  { key: 'issuePrice', re: /^\d?\.?신주발행가액$|^전환가액$|^행사가액$/, kind: 'money' },
  { key: 'basePrice', re: /^\d?\.?기준주가$/, kind: 'money' },
  { key: 'discount', re: /^.*할인율.*할증율.*$|^.*할인율\(할증률\).*$/, kind: 'pct' },
  { key: 'faceAmount', re: /^\d?\.?사채의권면\(?전자등록\)?총액$|^사채의권면총액$|^발행예정금액$|^실제발행금액$/, kind: 'money' },
  { key: 'payDate', re: /^\d?\.?납입일$/, kind: 'date' },
  { key: 'boardDate', re: /^\d{0,2}\.?이사회결의일\(?결정일\)?$|^발행결정최초이사회결의일$/, kind: 'date' },
  { key: 'method', re: /^\d?\.?증자방식$|^\d?\.?발행방법$|^사채의종류$|^증권의종류$/, kind: 'text' },
]

// 자금 용도. 서식이 목적별로 칸을 나눠 놓는다.
const PURPOSES = [
  ['시설자금', 'facility'],
  ['영업양수자금', 'acquisition'],
  ['운영자금', 'operating'],
  ['채무상환자금', 'debtRepay'],
  ['타법인증권취득자금', 'securities'],
  ['기타자금', 'etc'],
]

/** 이 문서가 자본조달 공시인지 */
export function isFundingForm(text) {
  const head = text.slice(0, 2000)
  return /유상증자\s*결정|전환사채권\s*발행결정|신주인수권부사채권\s*발행결정|교환사채권\s*발행결정|증권\s*발행결과/.test(head)
}

/**
 * @returns {null | {kind, fields, purposes, totalRaised, rows}}
 */
export function parseFunding(doc) {
  const text = doc.fullText
  if (!isFundingForm(text)) return null

  const rows = doc.rows.map((r) => (r.cells || []).map((c) => String(c).trim()).filter(Boolean))

  const fields = {}
  const purposes = {}

  for (const cells of rows) {
    if (cells.length < 2) continue
    const label = cells[0].replace(/\s+/g, '').replace(/^[※▶-]\s*/, '')

    // 자금 용도는 "운영자금 (원) | 999,999,990" 처럼 두 번째 칸이 라벨인 경우가 있다.
    // 먼저 나온 값(본표)을 지킨다 — 뒤쪽 '기타 투자판단에 참고할 사항' 문단에도
    // 같은 낱말이 섞여 있어 나중 것을 취하면 엉뚱한 숫자를 문다(운영자금 1,890).
    for (const [name, key] of PURPOSES) {
      if (purposes[key]) continue
      const at = cells.findIndex((c) => c.replace(/\s+/g, '').startsWith(name))
      if (at < 0) continue
      const v = cells.slice(at + 1).map(parseAmount).find((n) => n != null)
      if (v != null && v > 0) purposes[key] = { label: name, amount: v }
    }

    for (const f of FIELDS) {
      if (fields[f.key] != null) continue
      if (!f.re.test(label)) continue
      const rest = cells.slice(1)
      if (f.kind === 'text') {
        const v = rest.find((c) => c && c !== '-')
        if (v) fields[f.key] = v
      } else if (f.kind === 'date') {
        const v = rest.map(toDate).find(Boolean)
        if (v) fields[f.key] = v
      } else {
        const v = rest.map(parseAmount).find((n) => n != null)
        if (v != null) fields[f.key] = v
      }
    }
  }

  if (!Object.keys(fields).length && !Object.keys(purposes).length) return null

  // 조달 총액: 사채는 권면총액, 증자는 발행가 × 주식수, 둘 다 없으면 용도 합계.
  const purposeSum = Object.values(purposes).reduce((a, p) => a + p.amount, 0)
  const byShares =
    fields.issuePrice != null && fields.newShares != null ? fields.issuePrice * fields.newShares : null
  const totalRaised = fields.faceAmount ?? byShares ?? (purposeSum || null)

  return {
    kind: formKind(text),
    fields,
    purposes,
    totalRaised,
    // 화면에서 표로 그대로 쓸 수 있게 정리해 둔다.
    rows: Object.entries(purposes).map(([, p]) => ({ label: p.label, amount: p.amount })),
  }
}

function formKind(text) {
  const head = text.slice(0, 2000)
  if (/증권\s*발행결과/.test(head)) return '발행결과'
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
