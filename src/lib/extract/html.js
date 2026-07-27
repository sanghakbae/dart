// DART 뷰어에서 저장한 HTML 공시 원문 처리.
// <table> 태그가 살아 있어 rowspan/colspan 만 펼치면 표 구조를 그대로 얻는다.

/**
 * DART 원문(dart4.xsd)은 표 셀에 <TD> 말고 <TE>·<TU> 를 쓴다.
 *
 * HTML 파서는 이 태그를 모르고, 모르는 요소가 <table> 안에 있으면 표 밖으로
 * 밀어낸다(foster parenting). 그러면 <TR> 하나에 들어 있던 계정과목·당기·전기가
 * 각각 별개의 행으로 흩어져, 표를 읽어도 전기 금액이 통째로 사라진다
 * (무하유 2024년 감사보고서: 33개 계정 중 전기 인식 1개).
 * DOMParser 에 넣기 전에 표준 셀로 바꿔 준다 — colspan/rowspan 은 그대로 살린다.
 */
const DART_CELL = /<(\/?)(TE|TU)\b([^>]*?)(\/?)>/gi

export function htmlifyDartCells(raw) {
  return raw.replace(DART_CELL, (_m, slash, _tag, attrs, selfClose) =>
    slash ? '</td>' : `<td${attrs}${selfClose}>`
  )
}

export async function extractHtml(file) {
  const raw = htmlifyDartCells(await readAsText(file))
  const doc = new DOMParser().parseFromString(raw, 'text/html')

  doc.querySelectorAll('script, style, noscript').forEach((n) => n.remove())

  const rows = []
  let pseudoPage = 1
  walk(doc.body || doc.documentElement)

  function walk(node) {
    if (!node) return
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase()
        if (tag === 'table') {
          for (const r of expandTable(child)) {
            rows.push({ page: pseudoPage, cells: r, text: r.join('\t'), fromTable: true })
          }
          continue
        }
        if (tag === 'hr' || (child.getAttribute?.('style') || '').includes('page-break')) pseudoPage++
        walk(child)
      } else if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.replace(/\s+/g, ' ').trim()
        if (t) rows.push({ page: pseudoPage, cells: [t], text: t })
      }
    }
  }

  return {
    kind: 'html',
    pageCount: pseudoPage,
    rows,
    fullText: rows.map((r) => r.text).join('\n'),
  }
}

/** rowspan/colspan 을 실제 격자로 펼쳐 2차원 배열을 만든다. */
function expandTable(table) {
  const grid = []
  const trs = Array.from(table.querySelectorAll('tr'))
  trs.forEach((tr, ri) => {
    if (!grid[ri]) grid[ri] = []
    let ci = 0
    for (const cell of Array.from(tr.children)) {
      if (!/^(td|th)$/i.test(cell.tagName)) continue
      while (grid[ri][ci] !== undefined) ci++
      const text = (cell.textContent || '').replace(/\s+/g, ' ').trim()
      const cs = Math.max(1, Number(cell.getAttribute('colspan') || 1))
      const rs = Math.max(1, Number(cell.getAttribute('rowspan') || 1))
      for (let r = 0; r < rs; r++) {
        for (let c = 0; c < cs; c++) {
          if (!grid[ri + r]) grid[ri + r] = []
          // 병합 셀은 첫 칸에만 값을 넣고 나머지는 빈칸으로 둔다.
          grid[ri + r][ci + c] = r === 0 && c === 0 ? text : ''
        }
      }
      ci += cs
    }
  })
  return grid
    .map((r) => Array.from(r, (v) => v ?? '').map((v) => v.trim()))
    .filter((r) => r.some((v) => v))
}

/**
 * DART 원문은 UTF-8 과 EUC-KR 이 섞여 있다.
 *
 * XML 선언의 encoding 은 믿을 수 없다 — 실제로는 UTF-8 인데 euc-kr 로 선언된 옛
 * 문서가 있고, 그대로 따르면 한글이 전부 "占쏙옙" 로 깨진다. 이건 '�' 검사로도 안 잡힌다
 * (깨진 결과가 전부 유효한 한글 코드포인트라서). 그래서 선언을 보지 않고 바이트로 판별한다.
 *
 * EUC-KR 바이트열은 UTF-8 로 엄격 디코딩하면 거의 반드시 실패한다. 그 성질을 쓴다.
 */
async function readAsText(file) {
  const buf = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }
}
