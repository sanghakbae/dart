// PDF 텍스트 레이어를 좌표 기준으로 줄·열로 복원한다.
// 줄 복원 알고리즘은 lines.js 에 분리해 두어 Node 에서도 실제 PDF 로 검증할 수 있다.

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { buildLines, fragmentsOf } from './lines.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export async function extractPdf(file, onProgress) {
  const buf = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise
  const pages = []

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    pages.push({ page: p, lines: buildLines(fragmentsOf(content.items)) })
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
