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

/** "제 25 (당) 기" → 25 */
export function extractTermNo(text) {
  const m = /제\s*(\d{1,3})\s*(?:\([당전]\)\s*)?기/.exec(text || '')
  return m ? Number(m[1]) : null
}
