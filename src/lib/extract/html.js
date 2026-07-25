// DART 뷰어에서 저장한 HTML 공시 원문 처리.
// <table> 태그가 살아 있어 rowspan/colspan 만 펼치면 표 구조를 그대로 얻는다.

export async function extractHtml(file) {
  const raw = await readAsText(file)
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

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onerror = () => reject(fr.error)
    fr.onload = () => resolve(String(fr.result || ''))
    // DART 원문은 EUC-KR 인 경우가 많다. UTF-8 로 읽어 깨지면 EUC-KR 로 재시도한다.
    fr.readAsText(file, 'utf-8')
  }).then(async (text) => {
    if (!/[�]/.test(text)) return text
    const buf = await file.arrayBuffer()
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return text
    }
  })
}
