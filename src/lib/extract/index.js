import { extractPdf } from './pdf.js'
import { extractHtml } from './html.js'
import { extractSheet } from './sheet.js'
import { readZip, pickMainEntry } from './zip.js'

export const ACCEPTED = '.zip,.pdf,.html,.htm,.xhtml,.xml,.xls,.xlsx,.xlsm,.csv,.tsv,.txt'

function kindOf(file) {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.zip')) return 'zip'
  if (name.endsWith('.pdf')) return 'pdf'
  // DART 원문은 확장자가 .xml 이지만 내용은 표 마크업이라 HTML 처리기가 그대로 읽는다.
  if (/\.(html?|xhtml|xml)$/.test(name)) return 'html'
  if (/\.(xlsx?|xlsm|csv|tsv)$/.test(name)) return 'sheet'
  if (name.endsWith('.txt')) return 'txt'
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.includes('zip')) return 'zip'
  if (file.type.includes('html') || file.type.includes('xml')) return 'html'
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

  // ZIP 이면 안에서 본문을 꺼내 그 파일로 다시 분석한다.
  // DART 에서 받은 묶음을 사용자가 풀지 않고 그대로 올릴 수 있게 하려는 것이다.
  if (kind === 'zip') {
    onProgress?.(0.05, '압축 푸는 중')
    const entries = await readZip(await file.arrayBuffer())
    const main = pickMainEntry(entries)
    if (!main) {
      throw new Error(
        `압축 안에서 분석할 문서를 찾지 못했습니다 (파일 ${entries.length}개).\n` +
          '감사보고서 HTML·PDF·엑셀이 들어 있는 ZIP 을 올려주세요.'
      )
    }
    // 바깥 ZIP 이름을 살려 둔다 — 회사명은 "[알체라]…" 처럼 그쪽에 붙어 있다.
    const inner = new File([await main.bytes()], mergeName(file.name, main.name), {
      type: guessType(main.name),
    })
    const sub = await extractDocument(inner, onProgress)
    sub.zipEntry = main.name
    sub.zipEntryCount = entries.length
    return sub
  }

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

  // 한글을 NFC 로 합친다.
  // DART 원문·일부 PDF 는 한글이 NFD(자모 분해)로 들어 있다. 눈으로는 같아 보이지만
  // 분해된 자모는 '가-힣' 범위 밖이라 파서의 한글 정규식(재무상태표·감사의견 …)이
  // 전부 빗나가고, 회사 키까지 해시로 떨어진다. 여기서 한 번에 맞춰 둔다.
  normalizeDoc(doc)

  if (!doc.rows.length || doc.fullText.replace(/\s/g, '').length < 50) {
    throw new Error(
      '문서에서 텍스트를 찾지 못했습니다. 스캔 이미지로 만든 PDF일 수 있습니다.\n' +
        'DART에서 내려받은 원문 PDF/HTML 또는 재무제표 엑셀 파일을 올려주세요.'
    )
  }

  doc.fileName = String(file.name || '').normalize('NFC')
  doc.fileSize = file.size
  return doc
}

/**
 * ZIP 이름과 내부 파일명을 합친다.
 * 회사명은 보통 바깥 ZIP 이름("[알체라]감사보고서(2026.03.18).zip")에 있고
 * 확장자는 안쪽 파일이 맞다. 회사 판정이 바깥 이름을 먼저 보므로 앞에 둔다.
 */
function mergeName(zipName, innerName) {
  const outer = String(zipName || '').replace(/\.zip$/i, '')
  const ext = (String(innerName).match(/\.[^./\\]+$/) || ['.html'])[0]
  return `${outer}${ext}`
}

function guessType(name) {
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  if (/\.(xlsx?|xlsm)$/i.test(name)) return 'application/vnd.ms-excel'
  if (/\.(csv|tsv|txt)$/i.test(name)) return 'text/plain'
  return 'text/html'
}

/** 문서 모델 전체(본문·표 셀)를 NFC 로 맞춘다. 이미 NFC 면 사실상 비용이 없다. */
function normalizeDoc(doc) {
  doc.fullText = String(doc.fullText || '').normalize('NFC')
  for (const r of doc.rows) {
    if (r.text) r.text = r.text.normalize('NFC')
    if (Array.isArray(r.cells)) {
      for (let i = 0; i < r.cells.length; i++) {
        if (typeof r.cells[i] === 'string') r.cells[i] = r.cells[i].normalize('NFC')
      }
    }
  }
}
