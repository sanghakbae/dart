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
    // 정정보고서. 같은 기간의 원본과 ID 가 같아 서로 덮어쓰므로, 어느 쪽이 최신인지
    // 판단하려면 이 표시가 필요하다(storage.js 에서 정정본이 원본을 이긴다).
    isAmendment: isAmendment(text, doc.fileName),
    pageCount: doc.pageCount || null,
    fileName: doc.fileName,
    fileSize: doc.fileSize,
    sourceKind: doc.kind,
  }
}

/**
 * 정정보고서 여부.
 *
 * 본문 아무 데서나 '정정' 을 찾으면 안 된다 — 「감사보고서 제출」 서식의
 * "…정정공시를 갈음합니다" 같은 안내 문구까지 걸려 멀쩡한 원본이 정정본으로 둔갑한다.
 * 파일명 말머리와 문서 제목 줄만 본다.
 */
function isAmendment(text, fileName) {
  if (/\[(정정|기재정정|첨부정정|첨부추가)\]/.test(String(fileName || ''))) return true
  // 제목 줄(문서 맨 앞 몇 줄)에 정정 표시가 붙는 경우만 인정한다.
  const title = text.slice(0, 300)
  return /\[\s*(기재)?정정\s*\]|【\s*(기재)?정정\s*】/.test(title)
}

/**
 * 보고서 종류. 표지 제목으로 판정한다.
 *
 * 본문 전체를 훑으면 안 된다 — 사업보고서 본문에도 "분기보고서 및 반기보고서를
 * 제출" 같은 서술이 있어, 2025 사업보고서가 '반기보고서' 로 뒤집혔다.
 * 종류 이름은 표지에 가장 먼저 나오므로, 가장 앞에서 걸리는 것을 택한다.
 */
function guessDocKind(text) {
  const kinds = [
    [/분기\s*보고서/, '분기보고서'],
    [/반기\s*보고서/, '반기보고서'],
    [/사업\s*보고서/, '사업보고서'],
    [/독립된\s*감사인의\s*검토보고서|검토보고서/, '검토보고서'],
    [/독립된\s*감사인의\s*감사보고서|감사보고서/, '감사보고서'],
  ]
  let best = null
  for (const [re, label] of kinds) {
    const m = re.exec(text)
    if (m && (best == null || m.index < best.index)) best = { index: m.index, label }
  }
  return best?.label || '재무제표'
}

// 줄 단위로만 매칭한다. 문자클래스에 \s 를 넣으면 줄바꿈을 넘어 표제까지 빨려 들어간다.
const H = '[가-힣A-Za-z0-9()·\\-& \\t]'
const COMPANY_PATTERNS = [
  // 사업·분기·반기보고서 표지: "회 사 명 : 주식회사 알체라" (글자 사이 공백이 흔하다)
  new RegExp(`회\\s*사\\s*명\\s*[:：]?[ \\t]*(${H}{2,40})`),
  new RegExp(`상\\s*호\\s*[:：][ \\t]*(${H}{2,40})`),
  // 감사보고서 수신문
  new RegExp(`(${H}{2,40}?)[ \\t]*(?:주주\\s*및\\s*이사회|주주와\\s*이사회|이사회\\s*및\\s*주주|주주)[ \\t]*귀중`),
  new RegExp(`^(주식회사[ \\t]*${H}{1,30})`),
  new RegExp(`^(${H}{2,30}?[ \\t]*주식회사)`),
  new RegExp(`^((?:\\(주\\)|㈜)[ \\t]*${H}{1,30})`),
  new RegExp(`^(${H}{2,30}?(?:\\(주\\)|㈜))`),
]

/**
 * DART 에서 내려받은 파일명은 "[회사명][정정]보고서종류(날짜).pdf" 꼴이다.
 * 본문에서 회사명을 못 찾았을 때 파일명 전체를 그대로 쓰면 보고서마다 회사가
 * 갈려 버리므로, 대괄호 안의 회사명만 떼어 쓴다. ([정정] 같은 말머리는 건너뛴다)
 */
const FILENAME_TAGS = /^(정정|기재정정|첨부정정|첨부추가|참고|정정신고|기재\s*정정)$/

/** 파일명 대괄호 안의 회사명. 말머리 태그([정정] 등)는 건너뛴다. 없으면 null. */
function bracketCompany(fileName) {
  const base = String(fileName || '').replace(/\.[^.]+$/, '')
  for (const m of base.matchAll(/\[([^\]]{1,40})\]/g)) {
    const tag = m[1].trim()
    if (!tag || FILENAME_TAGS.test(tag)) continue
    const name = cleanCompany(tag)
    if (name) return name
  }
  return null
}

/** 본문·파일명 모두 실패했을 때의 최후 이름 */
function companyFromFileName(fileName) {
  return bracketCompany(fileName) || String(fileName || '').replace(/\.[^.]+$/, '') || '알 수 없음'
}

/**
 * 저장된 원문만 가지고 회사명을 다시 판정한다.
 * 파서를 고치기 전에 올린 보고서가 엉뚱한 회사로 갈려 있을 때 되돌리는 용도다.
 */
export function resolveCompanyName(rawText, fileName) {
  return findCompany(String(rawText || '').slice(0, 6000), { fileName })
}

function findCompany(head, doc) {
  // DART 파일명은 "[회사명][정정]보고서종류(날짜).pdf" 로 항상 회사명을 달고 온다.
  // 본문 표지는 문서 종류마다 서식이 제각각이라 여기가 가장 확실하다. 먼저 본다.
  const fromName = bracketCompany(doc.fileName)
  if (fromName) return fromName

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
  // 최후 수단: 파일명에서 회사명만 떼어 쓴다.
  return companyFromFileName(doc.fileName)
}

// 표지에서는 "회 사 명 : 주식회사 알체라 대 표 이 사 : 홍길동" 처럼 한 줄에
// 여러 항목이 붙어 나오는 경우가 있다. 다음 항목이 시작되면 거기서 끊는다.
const NEXT_LABEL =
  /\s*(대\s*표\s*이\s*사|본\s*점\s*소\s*재\s*지|전\s*화\s*번\s*호|홈\s*페\s*이\s*지|작\s*성\s*책\s*임\s*자|사\s*업\s*연\s*도|업\s*종).*$/

function cleanCompany(raw) {
  let name = raw.replace(NEXT_LABEL, '').replace(/\s+/g, ' ').trim()
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
