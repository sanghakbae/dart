// 주석(Notes)은 감사보고서 분량의 대부분을 차지한다.
// "1. 회사의 개요" 처럼 번호가 붙은 표제를 기준으로 나누고 본문을 전부 보존한다.
//
// 주석 본문에는 표가 많이 들어 있다(비용의 성격별 분류, 차입금 내역 등).
// 셀 구조를 버리고 텍스트로 합치면 표가 한 문단으로 뭉개지므로,
// 추출기가 준 cells 를 살려 표 블록과 문단 블록으로 나눠 보관한다.

import { parseAmount } from './numbers.js'

const NOTE_HEAD = /^(\d{1,2})\.\s*(.{2,60})$/
const NOTE_START = /^주\s*석\s*$|재무제표에?\s*대한\s*주석/

export function parseNotes(doc) {
  const lines = doc.rows.map((r) => ({
    text: r.text.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim(),
    cells: (r.cells || []).map((c) => String(c).trim()).filter((c) => c !== ''),
    page: r.page,
  }))

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
    const line = lines[i]
    if (!line.text) continue
    const m = NOTE_HEAD.exec(line.text)
    if (m && isNoteHeading(m, lastNo)) {
      if (cur) items.push(cur)
      cur = { no: Number(m[1]), title: m[2].trim(), page: line.page, lines: [] }
      lastNo = Number(m[1])
      continue
    }
    if (cur) cur.lines.push(line)
  }
  if (cur) items.push(cur)

  /**
   * PDF 추출에서 표제 줄이 여러 개 누락될 수 있어 번호가 크게 건너뛰는 것도 허용한다.
   * 대신 본문 문장("3. 계약자산은 … 다음과 같습니다.")이 표제로 잡히지 않도록,
   * 큰 점프는 '문장으로 끝나지 않는 제목' 일 때만 인정한다.
   */
  function isNoteHeading(m, prevNo) {
    const no = Number(m[1])
    const title = m[2].trim()
    if (no <= prevNo || no > 60) return false
    if (!/[가-힣]{2}/.test(title)) return false
    if (/\d{1,3},\d{3}/.test(title)) return false
    const endsSentence = /[.。]$/.test(title) || /(습니다|입니다|한다|이다|있다|없다)$/.test(title)
    if (no > prevNo + 20 && endsSentence) return false
    return true
  }

  return {
    found: items.length > 0,
    startLine: start,
    count: items.length,
    items: items.map((it) => ({
      no: it.no,
      title: it.title,
      page: it.page,
      body: it.lines.map((l) => l.text).join('\n').trim(),
      content: buildContent(it.lines),
    })),
  }
}

/** 셀 중 금액으로 읽히는 개수 */
function amountCount(cells) {
  let n = 0
  for (const c of cells) if (parseAmount(c) !== null) n++
  return n
}

const HEADER_HINT = /구\s*분|당\s*기|전\s*기|과\s*목|금\s*액|내\s*역|합\s*계|계정과목|항\s*목/

/**
 * 주석 본문 줄들을 문단 블록과 표 블록으로 나눈다.
 * 금액 셀이 2개 이상인 줄이 이어지면 표로 본다(당기·전기 두 열이 기본 형태).
 */
function buildContent(lines) {
  const out = []
  let para = []
  let table = []

  // para 에는 줄 객체가 담긴다(표 머리행 판정에 cells 가 필요하다). 텍스트는 여기서 뽑는다.
  const flushPara = () => {
    if (para.length) out.push({ type: 'p', text: para.map((l) => l.text).join('\n') })
    para = []
  }
  const flushTable = () => {
    if (!table.length) {
      return
    }
    // 표 바로 앞의 짧은 줄이 열 제목이면 머리행으로 끌어올린다.
    let header = null
    if (para.length) {
      const last = para[para.length - 1]
      if (last.cells.length >= 2 && amountCount(last.cells) === 0 && last.text.length <= 60 && HEADER_HINT.test(last.text)) {
        header = last.cells
        para.pop()
      }
    }
    flushPara()
    const width = Math.max(...table.map((r) => r.length), header ? header.length : 0)
    out.push({
      type: 'table',
      header,
      rows: table.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]),
    })
    table = []
  }

  for (const line of lines) {
    const isRow = line.cells.length >= 2 && amountCount(line.cells) >= 2
    if (isRow) {
      table.push(line.cells)
      continue
    }
    if (table.length) flushTable()
    para.push(line)
  }
  flushTable()
  flushPara()
  return out
}
