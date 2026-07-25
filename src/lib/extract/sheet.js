// 엑셀/CSV 재무제표. 시트별 셀 격자를 그대로 행 배열로 넘긴다.

export async function extractSheet(file) {
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array', cellDates: false, raw: true })

  const rows = []
  wb.SheetNames.forEach((name, idx) => {
    const sheet = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    rows.push({ page: idx + 1, cells: [`[시트] ${name}`], text: `[시트] ${name}`, sheetHeader: true })
    for (const r of aoa) {
      const cells = r.map((v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim()))
      while (cells.length && !cells[cells.length - 1]) cells.pop()
      if (!cells.some((c) => c)) continue
      rows.push({ page: idx + 1, cells, text: cells.join('\t'), fromTable: true })
    }
  })

  return {
    kind: 'sheet',
    pageCount: wb.SheetNames.length,
    sheetNames: wb.SheetNames,
    rows,
    fullText: rows.map((r) => r.text).join('\n'),
  }
}
