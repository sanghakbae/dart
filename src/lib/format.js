// 금액 표기. 감사보고서 금액은 원 단위 정수라 자릿수가 커서 축약 표기를 함께 쓴다.

const UNITS = [
  { v: 1e12, s: '조' },
  { v: 1e8, s: '억' },
  { v: 1e4, s: '만' },
]

/** 12345678900 → "123.5억" */
export function abbrev(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '-'
  if (n === 0) return '0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  for (const u of UNITS) {
    if (abs >= u.v) {
      const val = abs / u.v
      return `${sign}${val.toLocaleString('ko-KR', { maximumFractionDigits: val >= 100 ? 0 : digits })}${u.s}`
    }
  }
  return `${sign}${abs.toLocaleString('ko-KR')}`
}

/** 전체 자릿수 표기: 1,234,567 */
export function full(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  return n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
}

/** 표에서 음수를 회계식 (1,234) 로 */
export function accounting(n) {
  if (n == null || !Number.isFinite(n)) return '-'
  const s = Math.abs(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 })
  return n < 0 ? `(${s})` : s
}

export function pctText(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${n.toLocaleString('ko-KR', { maximumFractionDigits: digits })}%`
}

export function signedPct(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '-'
  return `${n > 0 ? '+' : ''}${n.toLocaleString('ko-KR', { maximumFractionDigits: digits })}%`
}

export function ratioText(n, unit) {
  if (n == null || !Number.isFinite(n)) return '-'
  const v = n.toLocaleString('ko-KR', { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 1 })
  return unit === '%' ? `${v}%` : unit ? `${v}${unit}` : v
}

export function fileSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function dateText(v) {
  if (!v) return '-'
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export function dateTimeText(v) {
  if (!v) return '-'
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v))
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}
