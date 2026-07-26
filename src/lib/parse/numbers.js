// 감사보고서 표에 등장하는 숫자·단위 표기를 정규화한다.
// DART 공시 원문은 음수를 (1,234) 또는 △1,234 / ▲1,234 / -1,234 로 혼용한다.

const MINUS_PREFIX = /^[(（\-−–—△▲▽]/
const MINUS_SUFFIX = /[)）]$/
const NUM_BODY = /^[0-9,.\s]+$/

/** 셀 문자열이 금액 숫자로 읽히면 Number, 아니면 null */
export function parseAmount(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null

  let s = String(raw).trim()
  if (!s) return null

  // 주석 참조 표기(주5, (주2) 등)와 통화기호·단위 접미어 제거
  s = s.replace(/\(?주\s*\d+(?:[,·]\s*\d+)*\)?/g, '').trim()
  s = s.replace(/[₩원]/g, '').trim()
  if (!s || s === '-' || s === '－' || s === '—' || s === '–') return null

  let negative = false
  if (MINUS_PREFIX.test(s)) {
    negative = true
    s = s.replace(MINUS_PREFIX, '')
  }
  if (MINUS_SUFFIX.test(s)) {
    negative = true
    s = s.replace(MINUS_SUFFIX, '')
  }
  s = s.trim()
  if (!s || !NUM_BODY.test(s)) return null

  // 주석 참조 열은 "23,31,32" 처럼 쉼표로 번호를 나열한다. 천단위 구분자는 항상
  // 세 자리 묶음이므로, 묶음이 세 자리가 아니면 금액이 아니라 주석 번호다.
  const compact = s.replace(/\s/g, '')
  if (compact.includes(',')) {
    const [intPart] = compact.split('.')
    if (!/^\d{1,3}(,\d{3})+$/.test(intPart)) return null
  }

  // 천단위 구분자 제거. 소수점은 마지막 점만 인정한다.
  const cleaned = s.replace(/[,\s]/g, '')
  const lastDot = cleaned.lastIndexOf('.')
  let normalized = cleaned
  if (lastDot >= 0) {
    const intPart = cleaned.slice(0, lastDot).replace(/\./g, '')
    const decPart = cleaned.slice(lastDot + 1)
    // 3자리 단위로 점을 쓴 표기(1.234.567)는 소수가 아니라 구분자다.
    normalized = decPart.length === 3 && /^\d{3}$/.test(decPart) && intPart.length > 0 && !cleaned.includes(',')
      ? intPart + decPart
      : `${intPart}.${decPart}`
  }

  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

export function looksNumeric(raw) {
  return parseAmount(raw) !== null
}

const UNIT_TABLE = [
  { re: /단위\s*[:：]?\s*\(?\s*조\s*원/, factor: 1e12, label: '조원' },
  { re: /단위\s*[:：]?\s*\(?\s*십억\s*원/, factor: 1e9, label: '십억원' },
  { re: /단위\s*[:：]?\s*\(?\s*억\s*원/, factor: 1e8, label: '억원' },
  { re: /단위\s*[:：]?\s*\(?\s*백만\s*원/, factor: 1e6, label: '백만원' },
  { re: /단위\s*[:：]?\s*\(?\s*만\s*원/, factor: 1e4, label: '만원' },
  { re: /단위\s*[:：]?\s*\(?\s*천\s*원/, factor: 1e3, label: '천원' },
  { re: /단위\s*[:：]?\s*\(?\s*원/, factor: 1, label: '원' },
  { re: /\(\s*단위\s*[:：]\s*USD|미화\s*달러/, factor: 1, label: 'USD' },
]

/**
 * "(단위: 천원)" 같은 표기를 찾아 원화 환산 배수를 돌려준다.
 * 못 찾으면 원(1) 기준으로 본다.
 */
export function detectUnit(text) {
  if (!text) return { factor: 1, label: '원', found: false }
  for (const u of UNIT_TABLE) {
    if (u.re.test(text)) return { factor: u.factor, label: u.label, found: true }
  }
  return { factor: 1, label: '원', found: false }
}

/** 텍스트에서 사업연도 후보(1990~2100)를 등장 순서대로 뽑는다. */
export function extractYears(text) {
  if (!text) return []
  const out = []
  const re = /(19[9]\d|20\d{2}|21\d{2})\s*(?:년|\.|-|\/)/g
  let m
  while ((m = re.exec(text))) {
    const y = Number(m[1])
    if (y >= 1990 && y <= 2100) out.push(y)
  }
  return out
}

// 보고기간 종료월로 연간·반기·분기를 가른다.
// 상장회사는 분기·반기보고서(검토보고서)를 함께 공시하므로, 이걸 구분하지 않으면
// 3분기 누적 실적이 연간 실적과 같은 축에 섞여 비교가 성립하지 않는다.
const PERIOD_BY_END_MONTH = {
  3: { type: 'Q1', label: '1분기', order: 1 },
  6: { type: 'H1', label: '반기', order: 2 },
  9: { type: 'Q3', label: '3분기', order: 3 },
  12: { type: 'FY', label: '연간', order: 4 },
}

export const ANNUAL = { type: 'FY', label: '연간', order: 4 }

/**
 * 문서에서 당기 보고기간의 종료 시점을 찾아 기간 종류를 판정한다.
 * "2024년 1월 1일부터 2024년 9월 30일까지" → 3분기
 * "2024년 12월 31일 현재"                  → 연간
 */
export function detectPeriodType(text) {
  if (!text) return { ...ANNUAL, found: false }

  const ends = []
  const push = (m) => {
    const month = Number(m)
    if (PERIOD_BY_END_MONTH[month]) ends.push(month)
  }

  // "…부터 2024년 9월 30일까지" 형태를 최우선으로 본다.
  const re = /부터[^\n]{0,30}?(?:20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*\d{1,2}\s*일?\s*까지/g
  let m
  while ((m = re.exec(text))) push(m[1])

  // 재무상태표는 "…현재" 로만 표기된다.
  if (!ends.length) {
    const re2 = /(?:20\d{2})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*\d{1,2}\s*일?\s*현재/g
    while ((m = re2.exec(text))) push(m[1])
  }

  if (ends.length) {
    // 같은 문서에 여러 기간이 나오면 가장 많이 등장한 종료월을 당기로 본다.
    const freq = new Map()
    for (const e of ends) freq.set(e, (freq.get(e) || 0) + 1)
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
    return { ...PERIOD_BY_END_MONTH[top], endMonth: top, found: true }
  }

  // 종료일을 못 찾으면 표제 키워드로 되짚는다.
  if (/반기\s*보고서|반\s*기\s*검토/.test(text)) return { type: 'H1', label: '반기', order: 2, found: true }
  const q = /제?\s*([1-4])\s*분기/.exec(text)
  if (q) {
    const n = Number(q[1])
    if (n === 1) return { type: 'Q1', label: '1분기', order: 1, found: true }
    if (n === 2) return { type: 'H1', label: '반기', order: 2, found: true }
    if (n === 3) return { type: 'Q3', label: '3분기', order: 3, found: true }
  }
  return { ...ANNUAL, found: false }
}

/** "제 25 (당) 기" → 25 */
export function extractTermNo(text) {
  const m = /제\s*(\d{1,3})\s*(?:\([당전]\)\s*)?기/.exec(text || '')
  return m ? Number(m[1]) : null
}
