// 표지·수신문에서 회사명, 사업연도, 감사인, 감사보고서일, 연결/별도 구분을 뽑는다.

import { extractYears, extractTermNo, detectPeriodType } from './numbers.js'
import { SUBSIDIARY_PHRASE } from '../company.js'

const AUDIT_FIRM_RE =
  /((?:삼일|삼정|한영|안진|대주|우리|신한|한울|정진세림|이촌|다산|성현|서현|현대|au|EY|KPMG|PwC|Deloitte)[^\n]{0,20}?회계법인|[가-힣A-Za-z][^\n]{0,18}?회계법인|[^\n]{0,18}?감사반)/

export function parseMeta(doc) {
  const text = doc.fullText
  const head = text.slice(0, 6000)
  const period = detectPeriodType(text)
  const fiscalYear = findFiscalYear(text)

  return {
    periodType: period.type,        // FY · H1 · Q3 · Q1
    periodLabel: period.label,     // 연간 · 반기 · 3분기 · 1분기
    company: findCompany(head, doc),
    auditor: findAuditor(text),
    reportDate: findReportDate(text, fiscalYear),
    fiscalYear,
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
  // 연결재무제표 표제의 "○○주식회사와 그 종속기업" — 떼지 않으면 같은 회사의
  // 연결·별도 보고서가 서로 다른 회사로 갈린다.
  name = name.replace(SUBSIDIARY_PHRASE, ' ').replace(/\s+/g, ' ').trim()
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

/**
 * 감사보고서일.
 * "이 감사보고서는 감사보고서일(2025년 3월 21일) 현재로 유효…" 처럼 명시된 표기가 가장 정확하다.
 * 없으면 보고기간 종료일 이후에 처음 나오는 날짜를 쓴다 — 본문에는 회계기간 날짜가
 * 수없이 등장해서 단순히 '첫 날짜'를 잡으면 사업연도 개시일(1월 1일)이 걸린다.
 */
function findReportDate(text, fiscalYear) {
  const explicit = [
    /감사보고서일\s*\(?\s*(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?\s*\)?/,
    /검토보고서일\s*\(?\s*(20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})\s*일?\s*\)?/,
  ]
  for (const re of explicit) {
    const m = re.exec(text)
    if (m) return iso(m)
  }

  const all = [...text.matchAll(/(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)]
  if (!all.length) return null

  if (fiscalYear) {
    // 보고기간 종료(사업연도 말) 이후 ~ 1년 이내의 가장 이른 날짜가 감사보고서일이다.
    const after = all
      .map((m) => ({ m, t: Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) }))
      .filter((d) => d.t > Date.UTC(fiscalYear, 11, 31) && d.t <= Date.UTC(fiscalYear + 1, 11, 31))
      .sort((a, b) => a.t - b.t)
    if (after.length) return iso(after[0].m)
  }

  // 회계법인 서명 근처의 날짜
  const nearFirm = /(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일[^\n]{0,30}\n?[^\n]{0,30}회계법인/.exec(text)
  if (nearFirm) return iso(nearFirm)
  return iso(all[all.length - 1])
}

function iso(m) {
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
}

/**
 * 사업연도는 '당기 보고기간의 종료일'이 정답이다.
 * 주석에는 "2025년 1월 1일 이후 개시하는 회계기간부터…" 처럼 미래 연도가 반복 등장하므로
 * 빈도만으로 고르면 엉뚱한 연도를 잡는다. 신뢰도 순으로 좁혀 간다.
 */
function findFiscalYear(text) {
  // 1) 당기 기간 헤더의 종료 연도 — "제 15 (당) 기 2024년 1월 1일부터 2024년 12월 31일까지"
  const fromCurrentTerm = []
  const termRe = /제\s*\d{1,3}\s*\(?\s*당\s*\)?\s*(?:기|반기|분기)[^\n]{0,140}/g
  let m
  while ((m = termRe.exec(text))) {
    const years = [...m[0].matchAll(/(20\d{2})/g)].map((x) => Number(x[1]))
    if (years.length) fromCurrentTerm.push(years[years.length - 1]) // 종료일 쪽 연도
  }
  if (fromCurrentTerm.length) return mode(fromCurrentTerm)

  // 2) 보고기간 종료 표현 — "2024년 12월 31일 현재 / 까지 / 로 종료되는"
  const ends = [
    ...text.matchAll(/(20\d{2})\s*[년.\-/]\s*\d{1,2}\s*[월.\-/]\s*\d{1,2}\s*일?\s*(?:현재|까지|로\s*종료되는|으로\s*종료되는)/g),
  ].map((x) => Number(x[1]))
  if (ends.length) return mode(ends)

  // 3) 기수 표기 뒤에 바로 연도가 붙는 형태
  const m3 = /제\s*\d+\s*(?:\(당\))?\s*기\s*[:：]?\s*(20\d{2})/.exec(text)
  if (m3) return Number(m3[1])

  // 4) 최후 수단: 표지·감사의견 구간(주석 이전)에서만 빈도를 본다.
  const head = text.slice(0, 4000)
  const years = extractYears(head)
  if (!years.length) return null
  return mode(years)
}

/** 최빈값. 동률이면 큰 연도를 택한다. */
function mode(nums) {
  const freq = new Map()
  for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1)
  return [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
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
