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

/**
 * PDF에서 뽑은 텍스트는 종이의 한 줄마다 개행이 들어 있어, 그대로 보여주면
 * 화면 폭을 못 채우고 원본 종이 폭에서 줄이 끊긴다.
 * 문단을 다시 이어 붙여 브라우저가 행 끝에서 개행하게 만든다.
 */
export function toParagraphs(text) {
  const lines = String(text || '').split(/\r?\n/)
  const lengths = lines.map((l) => l.trim().length).filter((n) => n > 0)
  if (!lengths.length) return []
  const sorted = [...lengths].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]

  // 표제·번호 항목은 항상 새 문단으로 끊는다.
  const startsBlock = (s) =>
    /^(?:\(?\d+(?:[.\-]\d+)*\)?\s*[.)]?\s+\S|[가-하][.)]\s|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.)]?\s|[-–·•▪※■□]\s?\S)/.test(s)
  // 문장이 끝나고 그 줄이 평소보다 짧으면 문단의 마지막 줄로 본다.
  const endsParagraph = (s) => /[.?!:;。]$|다\.$/.test(s) && s.length < median * 0.85

  const out = []
  let buf = ''
  const flush = () => {
    if (buf.trim()) out.push(buf.trim())
    buf = ''
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    // "2.1 재무제표 작성기준" 처럼 짧고 마침표가 없는 번호 항목은 그 자체가 소제목이다.
    // 뒤 문단과 붙지 않도록 한 줄로 떼어 낸다.
    if (startsBlock(line) && line.length < median * 0.85 && !/[.。:]$/.test(line)) {
      flush()
      out.push(line)
      continue
    }
    if (!buf) {
      buf = line
    } else if (startsBlock(line)) {
      flush()
      buf = line
    } else {
      buf += ` ${line}`
    }
    if (endsParagraph(line)) flush()
  }
  flush()
  return out
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
