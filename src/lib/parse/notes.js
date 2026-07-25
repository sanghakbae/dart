// 주석(Notes)은 감사보고서 분량의 대부분을 차지한다.
// "1. 회사의 개요" 처럼 번호가 붙은 표제를 기준으로 나누고 본문을 전부 보존한다.

const NOTE_HEAD = /^(\d{1,2})\.\s*(.{2,60})$/
const NOTE_START = /^주\s*석\s*$|재무제표에?\s*대한\s*주석/

export function parseNotes(doc) {
  const lines = doc.rows.map((r) => ({ text: r.text.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim(), page: r.page }))

  let start = lines.findIndex((l) => NOTE_START.test(l.text))
  if (start < 0) {
    // 표제가 없더라도 "1. 회사의 개요" 가 있으면 그 지점부터 주석으로 본다.
    start = lines.findIndex((l) => /^1\.\s*(회사의?\s*개요|일반사항)/.test(l.text))
  }
  if (start < 0) return { found: false, items: [], count: 0 }

  const items = []
  let cur = null
  let lastNo = 0

  for (let i = start + 1; i < lines.length; i++) {
    const { text, page } = lines[i]
    if (!text) continue
    const m = NOTE_HEAD.exec(text)
    if (m && isNoteHeading(m, lastNo)) {
      if (cur) items.push(cur)
      cur = { no: Number(m[1]), title: m[2].trim(), page, lines: [] }
      lastNo = Number(m[1])
      continue
    }
    if (cur) cur.lines.push(text)
  }
  if (cur) items.push(cur)

  // PDF 추출에서 표제 한 줄이 누락될 수 있어 번호가 건너뛰는 것은 허용하고,
  // 번호가 커지는 방향과 '한글 제목' 조건으로 표 안의 "1. 2,345" 류 오탐만 걸러낸다.
  function isNoteHeading(m, lastNo) {
    const no = Number(m[1])
    const title = m[2].trim()
    if (no <= lastNo || no > lastNo + 20) return false
    if (!/[가-힣]{2}/.test(title)) return false
    if (/\d{1,3},\d{3}/.test(title)) return false
    return true
  }

  return {
    found: items.length > 0,
    startLine: start,
    count: items.length,
    items: items.map((it) => ({ no: it.no, title: it.title, page: it.page, body: it.lines.join('\n').trim() })),
  }
}
