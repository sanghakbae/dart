// PDF 텍스트 레이어를 좌표 기준으로 줄·열로 복원한다.
// pdf.js 는 표 구조를 주지 않으므로 y 근접도로 줄을 묶고, x 간격으로 셀을 나눈다.

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const Y_TOLERANCE = 3.2 // 같은 줄로 볼 y 차이(pt)
const CELL_GAP = 7.5 // 이 이상 벌어지면 다른 열로 본다(pt)

export async function extractPdf(file, onProgress) {
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise
  const pages = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push({ page: p, lines: buildLines(content.items) })
    page.cleanup()
    onProgress?.(p / doc.numPages, `PDF ${p}/${doc.numPages} 페이지 읽는 중`)
  }

  const rows = []
  for (const pg of pages) {
    for (const line of pg.lines) {
      rows.push({ page: pg.page, y: line.y, cells: line.cells.map((c) => c.text), text: line.text })
    }
  }

  await doc.destroy()
  return {
    kind: 'pdf',
    pageCount: pages.length,
    rows,
    fullText: rows.map((r) => r.text).join('\n'),
  }
}

function buildLines(items) {
  const frags = []
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue
    const t = it.transform
    frags.push({
      x: t[4],
      y: t[5],
      w: it.width || 0,
      h: Math.abs(t[3]) || it.height || 10,
      text: it.str,
    })
  }
  if (!frags.length) return []

  // y 내림차순(위→아래) 정렬 후 근접한 것끼리 줄로 묶는다.
  frags.sort((a, b) => b.y - a.y || a.x - b.x)
  const buckets = []
  for (const f of frags) {
    const last = buckets[buckets.length - 1]
    if (last && Math.abs(last.y - f.y) <= Y_TOLERANCE) {
      last.items.push(f)
      last.y = (last.y * (last.items.length - 1) + f.y) / last.items.length
    } else {
      buckets.push({ y: f.y, items: [f] })
    }
  }

  return buckets.map((b) => {
    b.items.sort((a, b2) => a.x - b2.x)
    const cells = []
    for (const f of b.items) {
      const cur = cells[cells.length - 1]
      if (cur && f.x - (cur.x + cur.w) < CELL_GAP) {
        // 같은 셀 안에서 이어지는 조각: 시각적 공백이 있으면 스페이스로 채운다.
        const needSpace = f.x - (cur.x + cur.w) > 1.2 && !/\s$/.test(cur.text)
        cur.text += (needSpace ? ' ' : '') + f.text
        cur.w = f.x + f.w - cur.x
      } else {
        cells.push({ x: f.x, w: f.w, text: f.text })
      }
    }
    const trimmed = cells
      .map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() }))
      .filter((c) => c.text)
    return { y: b.y, cells: trimmed, text: trimmed.map((c) => c.text).join('\t') }
  }).filter((l) => l.cells.length)
}
