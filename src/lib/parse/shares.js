// 주주·주식 정보. 감사보고서는 지분 현황을 따로 표로 싣지 않고
// 주석 '회사의 개요'와 '자본금'·'주식선택권' 주석에 흩어 놓는다.
//   "최대 주주(보통주)이자 대표이사인 신동호는 2,717,600주(지분율 67.94%)의 주식을 보유"
//   "수권주식수 50,000,000주 / 발행주식수 4,000,000주"
// 숫자만 뽑으면 맥락이 사라지므로 근거가 된 주석 본문도 함께 담는다.

import { parseAmount } from './numbers.js'

const SHARE_COUNT = /([\d,]+)\s*주/
const ROLE = '대표이사|사내이사|사외이사|기타비상무이사|등기임원|미등기임원|임원|이사|감사|대주주|최대주주'

export function parseShares(doc, notes) {
  const text = doc.fullText
  const rows = doc.rows

  const major = findMajorShareholder(text)
  const executives = findExecutiveHoldings(text)
  const authorized = findShareRow(rows, /^수권주식수/)
  const issued = findShareRow(rows, /^발행주식수/, authorized?.index)
  const treasury = findShareRow(rows, /^자기주식/)

  const shares = {
    majorShareholder: major,
    executives,
    authorizedShares: authorized?.value ?? null,
    issuedShares: issued?.value ?? null,
    issuedSharesPrior: issued?.prior ?? null,
    treasuryShares: treasury?.value ?? null,
    hasStockOption: /주식\s*선택권|스톡\s*옵션/.test(text),
    hasPreferred: /(전환상환우선주|종류주식|우선주)/.test(text),
    shareholders: findShareholderTable(rows),
  }

  // 근거 주석 — 숫자의 출처를 바로 읽을 수 있게 본문을 함께 보관한다.
  shares.sourceNotes = collectSourceNotes(notes, shares)
  shares.found =
    Boolean(major) ||
    executives.length > 0 ||
    shares.issuedShares != null ||
    shares.shareholders.length > 0
  return shares
}

/** "최대 주주 … 신동호는 2,717,600주(지분율 67.94%)" */
function findMajorShareholder(text) {
  const re = /최대\s*주주[^\n]{0,40}?([가-힣]{2,12})\s*(?:은|는|이|가)\s*([\d,]+)\s*주[^\n]{0,24}?([\d.]+)\s*%/
  const m = re.exec(text)
  if (m) return { name: m[1], shares: parseAmount(m[2]), ratio: Number(m[3]), raw: m[0].trim() }

  const loose = /최대\s*주주[^\n]{0,60}?([가-힣]{2,12})\s*(?:은|는|이|가)[^\n]{0,40}?([\d.]+)\s*%/.exec(text)
  if (loose) return { name: loose[1], shares: null, ratio: Number(loose[2]), raw: loose[0].trim() }
  return null
}

/**
 * 임원 보유 주식.
 * 문장형("대표이사인 신동호는 2,717,600주")과 표형(임원명 | 직위 | 주식수)을 모두 본다.
 */
function findExecutiveHoldings(text) {
  const out = []
  const seen = new Set()
  const push = (name, role, shares, ratio, raw) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    out.push({ name, role: role || null, shares: shares ?? null, ratio: ratio ?? null, raw })
  }

  // "…대표이사인 신동호는 2,717,600주(지분율 67.94%)의 주식을 보유"
  const re = new RegExp(
    `(${ROLE})\\s*(?:인|이신|였던)?\\s*([가-힣]{2,12})\\s*(?:은|는|이|가)\\s*([\\d,]+)\\s*주(?:[^\\n]{0,24}?([\\d.]+)\\s*%)?`,
    'g'
  )
  let m
  while ((m = re.exec(text))) {
    push(m[2], m[1], parseAmount(m[3]), m[4] ? Number(m[4]) : null, m[0].trim())
  }

  // "신동호(대표이사)는 …주" 순서가 뒤집힌 표기
  const re2 = new RegExp(`([가-힣]{2,12})\\s*\\((${ROLE})\\)\\s*(?:은|는|이|가)?\\s*([\\d,]+)\\s*주`, 'g')
  while ((m = re2.exec(text))) {
    push(m[1], m[2], parseAmount(m[3]), null, m[0].trim())
  }

  return out
}

/**
 * "수권주식수 | 50,000,000주 | 80,000주" 형태의 행에서 당기 값을 읽는다.
 * near 가 주어지면 그 근처(같은 표)에 있는 행을 우선한다.
 */
function findShareRow(rows, labelRe, near) {
  const hits = []
  rows.forEach((r, index) => {
    const cells = (r.cells || []).map((c) => String(c).trim())
    if (!cells.length) return
    const label = cells[0].replace(/\s+/g, '')
    if (!labelRe.test(label)) return
    const nums = cells.slice(1).map(readShares).filter((v) => v != null)
    if (!nums.length) return
    hits.push({ index, value: nums[0], prior: nums[1] ?? null })
  })
  if (!hits.length) return null
  if (near == null) return hits[0]
  return [...hits].sort((a, b) => Math.abs(a.index - near) - Math.abs(b.index - near))[0]
}

function readShares(cell) {
  const m = SHARE_COUNT.exec(cell)
  const v = parseAmount(m ? m[1] : cell)
  return v == null ? null : v
}

/** 주주 구성 표(있는 경우). 감사보고서에는 대개 없고 사업보고서에 있다. */
function findShareholderTable(rows) {
  const out = []
  let inTable = false
  for (const r of rows) {
    const cells = (r.cells || []).map((c) => String(c).trim())
    const joined = cells.join(' ').replace(/\s+/g, '')
    if (/주주(명|현황)|주주구성/.test(joined) && /(주식수|지분율|보유주식)/.test(joined)) {
      inTable = true
      continue
    }
    if (!inTable) continue
    if (cells.length < 2) {
      if (out.length) break
      continue
    }
    const shares = readShares(cells[1])
    const ratio = cells[2] ? Number(String(cells[2]).replace(/[^\d.]/g, '')) : null
    if (shares == null) {
      if (out.length) break
      continue
    }
    out.push({ name: cells[0], shares, ratio: Number.isFinite(ratio) ? ratio : null })
    if (out.length >= 20) break
  }
  return out
}

const SOURCE_HINT = /주주|지분율|주식수|자본금|주식선택권|스톡옵션|자기주식|액면/

/** 지분·주식 수치의 근거가 되는 주석을 본문째 골라 담는다. */
function collectSourceNotes(notes, shares) {
  const items = notes?.items || []
  if (!items.length) return []

  const names = [shares.majorShareholder?.name, ...shares.executives.map((e) => e.name)].filter(Boolean)
  const picked = []
  for (const n of items) {
    const body = n.body || ''
    const hitsName = names.some((nm) => body.includes(nm))
    const hitsTopic = SOURCE_HINT.test(`${n.title} ${body}`)
    if (!hitsName && !(hitsTopic && /^(회사의?\s*개요|일반\s*사항|자본금|주식선택권|자기주식|주당)/.test(n.title.replace(/\s+/g, ' ')))) {
      continue
    }
    // content(표) 는 배열의 배열이라 Firestore 에 그대로 못 넣는다.
    // 표는 주석 탭 데이터에서 주석 번호로 찾아 쓰고, 여기엔 본문 텍스트만 담는다.
    picked.push({ no: n.no, title: n.title, page: n.page, body })
    if (picked.length >= 6) break
  }
  return picked
}
