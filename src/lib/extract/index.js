import { extractPdf } from './pdf.js'
import { extractHtml } from './html.js'
import { extractSheet } from './sheet.js'

export const ACCEPTED = '.pdf,.html,.htm,.xhtml,.xls,.xlsx,.xlsm,.csv,.tsv,.txt'

function kindOf(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.pdf')) return 'pdf'
  if (/\.(html?|xhtml)$/.test(name)) return 'html'
  if (/\.(xlsx?|xlsm|csv|tsv)$/.test(name)) return 'sheet'
  if (name.endsWith('.txt')) return 'txt'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.includes('html')) return 'html'
  if (file.type.includes('sheet') || file.type.includes('csv')) return 'sheet'
  return null
}

/** 파일 → 공통 문서 모델 { kind, rows[{page,cells[],text}], fullText } */
export async function extractDocument(file, onProgress) {
  const kind = kindOf(file)
  if (!kind) {
    throw new Error(`지원하지 않는 형식입니다: ${file.name}\n지원 형식: PDF, HTML, 엑셀(xlsx/xls), CSV, TXT`)
  }
  onProgress?.(0.02, '파일 읽는 중')

  let doc
  if (kind === 'pdf') doc = await extractPdf(file, onProgress)
  else if (kind === 'html') doc = await extractHtml(file)
  else if (kind === 'sheet') doc = await extractSheet(file)
  else {
    const text = await file.text()
    const rows = text.split(/\r?\n/).map((line, i) => {
      const cells = line.split(/\t+|\s{2,}/).map((c) => c.trim()).filter(Boolean)
      return { page: 1, y: -i, cells: cells.length ? cells : [line.trim()], text: line.trim() }
    }).filter((r) => r.text)
    doc = { kind: 'txt', pageCount: 1, rows, fullText: text }
  }

  if (!doc.rows.length || doc.fullText.replace(/\s/g, '').length < 50) {
    throw new Error(
      '문서에서 텍스트를 찾지 못했습니다. 스캔 이미지로 만든 PDF일 수 있습니다.\n' +
        'DART에서 내려받은 원문 PDF/HTML 또는 재무제표 엑셀 파일을 올려주세요.'
    )
  }

  doc.fileName = file.name
  doc.fileSize = file.size
  return doc
}
