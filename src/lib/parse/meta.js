// 표지·수신문에서 회사명, 사업연도, 감사인, 감사보고서일, 연결/별도 구분을 뽑는다.

import { extractYears, extractTermNo, detectPeriodType } from './numbers.js'

const AUDIT_FIRM_RE =
  /((?:삼일|삼정|한영|안진|대주|우리|신한|한울|정진세림|이촌|다산|성현|서현|현대|au|EY|KPMG|PwC|Deloitte)[^\n]{0,20}?회계법인|[가-힣A-Za-z][^\n]{0,18}?회계법인|[^\n]{0,18}?감사반)/

export function parseMeta(doc) {
  const text = doc.fullText
  const head = text.slice(0, 6000)
  const period = detectPeriodType(text)

  return {
    periodType: period.type,        // FY · H1 · Q3 · Q1
    periodLabel: period.label,     // 연간 · 반기 · 3분기 · 1분기
    company: findCompany(head, doc),
    auditor: findAuditor(text),
    reportDate: findReportDate(text),
    fiscalYear: findFiscalYear(text),
    termNo: extractTermNo(text),
    basis: /연결\s*재무제표|연결재무상태표|연결감사보고서/.test(text) ? '연결' : '별도',
    periodLabels: findPeriodLabels(text),
    docKind: guessDocKind(text),
    pageCount: doc.pageCount || null,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    sourceKind: doc.kind,
  }
}

function guessDocKind(text) {
  if (/분기\s*보고서/.test(text)) return '분기보고서'
  if (/반기\s*보고서/.test(text)) return '반기보고서'
  if (/독립된\s*감사인의\s*감사보고서/.test(text)) return '감사보고서'
  if (/독립된\s*감사인의\s*검토보고서/.test(text)) return '검토보고서'
  if (/감사보고서/.test(text)) return '감사보고서'
  if (/사업보고서/.test(text)) return '사업보고서'
  return '재무제표'
}

// 줄 단위로만 매칭한다. 문자클래스에 \s 를 넣으면 줄바꿈을 넘어 표제까지 빨려 들어간다.
const H = '[가-힣A-Za-z0-9()·\\-& \\t]'
const COMPANY_PATTERNS = [
  new RegExp(`(${H}{2,40}?)[ \\t]*(?:주주\\s*및\\s*이사회|주주와\\s*이사회|이사회\\s*및\\s*주주|주주)[ \\t]*귀중`),
  new RegExp(`^(주식회사[ \\t]*${H}{1,30})`),
  new RegExp(`^(${H}{2,30}?[ \\t]*주식회사)`),
  new RegExp(`^((?:\\(주\\)|㈜)[ \\t]*${H}{1,30})`),
  new RegExp(`^(${H}{2,30}?(?:\\(주\\)|㈜))`),
]

function findCompany(head, doc) {
  const lines = head.split(/\r?\n/).slice(0, 80).map((l) => l.replace(/\t/g, ' ').trim()).filter(Boolean)
  for (const re of COMPANY_PATTERNS) {
    for (const line of lines) {
      if (line.length > 80) continue
      const m = re.exec(line)
      if (!m) continue
      const name = cleanCompany(m[1])
      if (name) return name
    }
  }
  // 최후 수단: 파일명
  return (doc.fileName || '알 수 없음').replace(/\.[^.]+$/, '')
}

function cleanCompany(raw) {
  let name = raw.replace(/\s+/g, ' ').trim()
  // 표제·수식어가 앞에 붙어 있으면 떼어낸다.
  name = name.replace(/^.*?(독립된\s*감사인의\s*(감사|검토)보고서|감사보고서|검토보고서|재무제표에?\s*대한)\s*/, '').trim()
  if (name.length < 2 || name.length > 40) return null
  if (/^제\s*\d/.test(name)) return null
  if (/^(과목|자산|부채|자본|합계|주석)$/.test(name)) return null
  return name
}

function findAuditor(text) {
  // 감사보고서 서명부는 문서 뒤쪽에 있다. 앞쪽 표지도 함께 본다.
  const zones = [text.slice(0, 4000), text.slice(-8000), text]
  for (const z of zones) {
    const m = AUDIT_FIRM_RE.exec(z)
    if (m) return m[1].replace(/\s+/g, ' ').trim()
  }
  return null
}

function findReportDate(text) {
  const pats = [
    /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*[\s\S]{0,40}?회계법인/,
    /감사보고서일\s*[:：]?\s*(20\d{2})[.\-년\s]+(\d{1,2})[.\-월\s]+(\d{1,2})/,
    /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g,
  ]
  for (const re of pats) {
    const m = re.exec(text)
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  }
  return null
}

function findFiscalYear(text) {
  // "2024년 12월 31일로 종료되는 보고기간" 이 가장 신뢰도 높다.
  const strong = [
    /(20\d{2})\s*년\s*12\s*월\s*31\s*일\s*(?:로|으로)?\s*(?:종료되는|종료하는)/,
    /(20\d{2})\s*[.\-]\s*12\s*[.\-]\s*31\s*(?:현재|까지)/,
    /제\s*\d+\s*(?:\(당\))?\s*기\s*[:：]?\s*(20\d{2})/,
  ]
  for (const re of strong) {
    const m = re.exec(text)
    if (m) return Number(m[1])
  }
  const years = extractYears(text.slice(0, 20000))
  if (!years.length) return null
  // 가장 자주 등장하는 연도 중 최댓값을 당기로 본다.
  const freq = new Map()
  for (const y of years) freq.set(y, (freq.get(y) || 0) + 1)
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const max = top[0][1]
  return Math.max(...top.filter(([, c]) => c >= max * 0.6).map(([y]) => y))
}

/** "제 25 (당) 기 2024.01.01 부터 2024.12.31 까지" 형태의 기간 헤더들 */
function findPeriodLabels(text) {
  const out = []
  const re = /제\s*(\d{1,3})\s*\(?([당전])\)?\s*기[^\n]{0,80}/g
  let m
  while ((m = re.exec(text)) && out.length < 8) {
    out.push({ termNo: Number(m[1]), which: m[2] === '당' ? 'current' : 'prior', raw: m[0].trim() })
  }
  return out
}
