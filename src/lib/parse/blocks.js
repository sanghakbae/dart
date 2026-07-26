// 문서 줄들을 화면용 블록(문단 · 표 · 목차)으로 나눈다.
// 주석과 감사보고서 절 모두 표를 품고 있어, 셀 구조를 버리고 텍스트로 합치면
// "종업원급여 6,661,227,265 7,306,901,198 주식보상비용 …" 처럼 읽을 수 없게 된다.

import { parseAmount } from './numbers.js'

const HEADER_HINT = /구\s*분|당\s*기|전\s*기|과\s*목|금\s*액|내\s*역|합\s*계|계정과목|항\s*목|회사명|비\s*고/
// "감 사 보 고 서 ...........1" 같은 목차 줄
const TOC_LINE = /^(.*?\S)\s*[.·․‥…]{3,}\s*(\d{1,4})\s*$/

/** 셀 중 금액으로 읽히는 개수 */
function amountCount(cells) {
  let n = 0
  for (const c of cells) if (parseAmount(c) !== null) n++
  return n
}

/**
 * 표 한 줄을 [항목명, 금액…] 으로 정규화한다.
 * DART 원문은 "합 계" 처럼 글자 사이에 공백이 있어 항목명이 여러 셀로 갈리는데,
 * 그대로 두면 줄마다 열 수가 달라져 빈 칸이 생긴다.
 */
function normalizeRow(cells) {
  const firstAmount = cells.findIndex((c) => parseAmount(c) !== null)
  if (firstAmount <= 0) return [...cells]
  const label = cells.slice(0, firstAmount).join(' ').replace(/\s+/g, ' ').trim()
  return [label, ...cells.slice(firstAmount)]
}

/**
 * @param {Array<{text:string, cells:string[]}>} lines
 * @returns {Array<{type:'p'|'table'|'toc', ...}>}
 */
export function buildContent(lines) {
  const out = []
  let para = []
  let table = []
  let toc = []

  const flushPara = () => {
    if (para.length) out.push({ type: 'p', text: para.map((l) => l.text).join('\n') })
    para = []
  }
  const flushToc = () => {
    if (toc.length) out.push({ type: 'toc', rows: toc })
    toc = []
  }
  const flushTable = () => {
    if (!table.length) return

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

    const width = Math.max(...table.map((r) => r.length))
    // "구 분" 처럼 글자 사이 공백이 있는 머리행은 여러 셀로 갈린다.
    // 데이터 열 수보다 많으면 앞쪽 여분을 하나로 합쳐 열을 맞춘다.
    let head = header
    if (head && head.length > width) {
      const extra = head.length - width
      head = [head.slice(0, extra + 1).join(' ').replace(/\s+/g, ' ').trim(), ...head.slice(extra + 1)]
    }

    out.push({
      type: 'table',
      header: head,
      rows: table.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]),
    })
    table = []
  }

  for (const line of lines) {
    const tocHit = TOC_LINE.exec(line.text)
    if (tocHit) {
      flushTable()
      flushPara()
      toc.push({ title: tocHit[1].replace(/\s+/g, ' ').trim(), page: Number(tocHit[2]) })
      continue
    }
    flushToc()

    const isRow = line.cells.length >= 2 && amountCount(line.cells) >= 2
    if (isRow) {
      table.push(normalizeRow(line.cells))
      continue
    }
    if (table.length) flushTable()
    para.push(line)
  }
  flushTable()
  flushToc()
  flushPara()
  return out
}
