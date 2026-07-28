// 주주·주식 정보. 감사보고서는 지분 현황을 따로 표로 싣지 않고
// 주석 '회사의 개요'와 '자본금'·'주식선택권' 주석에 흩어 놓는다.
//   "최대 주주(보통주)이자 대표이사인 신동호는 2,717,600주(지분율 67.94%)의 주식을 보유"
//   "수권주식수 50,000,000주 / 발행주식수 4,000,000주"
// 숫자만 뽑으면 맥락이 사라지므로 근거가 된 주석 본문도 함께 담는다.

import { parseAmount } from './numbers.js'

const SHARE_COUNT = /([\d,]+)\s*주/
// '감사' 는 '감사인'(회계법인)과 겹치므로 뒤에 '인' 이 오면 제외한다.
const ROLE = '대표이사|사내이사|사외이사|기타비상무이사|등기임원|미등기임원|임원|이사|감사(?!인)|대주주|최대주주'
// 법인·기관 이름은 임원이 아니다.
const NOT_PERSON = /(회계법인|법인|주식회사|유한회사|회사|은행|증권|보험|캐피탈|파트너스|조합|재단|기금|펀드|투자)$/

/**
 * @param {object} doc
 * @param {object} notes
 * @param {{rcps?:object|null, capital?:object|null}} [extra] 종류별 주식수를 만들 재료
 */
export function parseShares(doc, notes, extra = {}) {
  const text = doc.fullText
  const rows = doc.rows
  const { rcps = null, capital = null } = extra

  const major = findMajorShareholder(text)
  const executives = findExecutiveHoldings(text)
  const authorized = findShareRow(rows, /^수권주식수/)
  const issued = findShareRow(rows, /^발행주식수/, authorized?.index)
  const treasury = findShareRow(rows, /^자기주식/)

  const shares = {
    majorShareholder: major,
    executives,
    authorizedShares: capital?.authorizedShares ?? authorized?.value ?? null,
    // 자본금 주석의 발행주식수는 보통주만이다. 이름을 그대로 두면 뒤에서
    // 총 주식수로 오해하므로, 의미가 드러나는 이름을 따로 둔다.
    issuedShares: capital?.issuedShares ?? issued?.value ?? null,
    issuedSharesPrior: capital?.priorPeriod?.issuedShares ?? issued?.prior ?? null,
    treasuryShares: treasury?.value ?? null,
    parValue: capital?.parValue ?? null,
    capitalStock: capital?.capitalStock ?? null,
    capitalChanges: capital?.changes || [],
    stockOptions: capital?.stockOptions || null,
    hasStockOption: /주식\s*선택권|스톡\s*옵션/.test(text),
    hasPreferred: /(전환상환우선주|종류주식|우선주)/.test(text),
    shareholders: findShareholderTable(rows),
  }

  Object.assign(shares, composeShareCounts(shares, rcps, capital))
  if (major) shares.majorShareholder = withOwnershipBasis(major, shares)

  // 근거 주석 — 숫자의 출처를 바로 읽을 수 있게 본문을 함께 보관한다.
  shares.sourceNotes = collectSourceNotes(notes, shares)
  shares.found =
    Boolean(major) ||
    executives.length > 0 ||
    shares.issuedShares != null ||
    shares.preferredShares != null ||
    shares.capitalChanges.length > 0 ||
    shares.shareholders.length > 0
  return shares
}

/**
 * 주식 종류별 수를 맞춘다.
 *
 * 감사보고서는 이걸 한 곳에 모아 두지 않는다 — 보통주는 자본금 주석, 상환전환우선주는
 * 부채 주석, 주식선택권은 또 다른 주석에 흩어져 있다. 그래서 여태 화면에는 보통주만
 * 나왔고, 1주당 가치가 그만큼 과대였다.
 *
 *   보통주 4,000,000 + RCPS 685,800 = 총 4,685,800 (등기부와 일치)
 *   + 주식선택권 133,800 = 완전희석 4,819,600
 */
function composeShareCounts(shares, rcps, capital) {
  const issued = shares.issuedShares
  const preferred = rcps?.shares ?? null
  const potential = capital?.stockOptions?.potentialShares ?? null

  // 자본금 주석의 발행주식수가 이미 우선주를 품고 있는지 가른다.
  // 그냥 더하면 이중으로 세어 총수가 부풀려진다(무하유 2024년 23,429주가 26,858주로).
  const bundled = includesPreferred(capital, issued, preferred)
  const common = bundled ? issued - preferred : issued

  // 보통주를 못 읽었으면 총수를 지어내면 안 된다. 우선주만 총수로 잡히면
  // 기업가치가 그 수로 매겨져 통째로 틀어진다.
  const total = issued != null ? (bundled ? issued : issued + (preferred ?? 0)) : null
  const diluted = total != null ? total + (potential ?? 0) : null

  const byType = []
  if (common != null) byType.push({ key: 'common', label: '보통주', shares: common })
  if (preferred != null) byType.push({ key: 'preferred', label: '상환전환우선주', shares: preferred })

  return {
    commonShares: common,
    preferredShares: preferred,
    potentialShares: potential,
    totalShares: total,
    dilutedShares: diluted,
    byType,
    // 총 주식수를 보통주만으로 잡고 있었는지 — 화면에서 이 사실을 밝혀야 한다.
    preferredHidden: preferred != null && preferred > 0,
  }
}

/**
 * 자본금 주석의 발행주식수가 이미 우선주를 품고 있는가.
 *
 * 회계기준에 따라 다르다.
 *   K-IFRS  : 상환전환우선주를 부채로 뺀다 → 발행주식수는 보통주만
 *   K-GAAP  : 자본(우선주자본금)으로 본다  → 발행주식수에 우선주가 함께 들어 있다
 *
 * 무하유가 딱 이 경우다. 2024년 보고서(K-GAAP)는 자본금을 보통주 1억 + 우선주
 * 1,714만으로 나눠 적고 발행주식수를 23,429주(= 보통주 20,000 + 우선주 3,429)로
 * 적었다. 2025년(K-IFRS)은 4,000,000주(보통주만)로 적었다.
 *
 * 문서에 기준이 명시돼 있지 않아도, 보통주자본금 ÷ 액면가로 보통주 수를 되짚어
 * 견주면 갈린다 — 우선주를 뺀 나머지가 그 수와 맞으면 이미 품고 있는 것이다.
 */
function includesPreferred(capital, issued, preferred) {
  if (!preferred || issued == null) return false
  const par = capital?.parValue
  const stock = capital?.capitalStock
  if (!par || !stock) return false

  const impliedShares = stock / par
  const label = capital?.capitalStockLabel || ''
  const near = (a, b) => Math.abs(a - b) < 1

  // '보통주자본금' 이면 되짚은 수가 보통주 수다. 발행주식수에서 우선주를 뺀 값이
  // 그 수와 맞으면, 발행주식수가 이미 우선주를 품고 있다는 뜻이다.
  if (near(issued - preferred, impliedShares)) return true

  // 라벨이 '보통주' 없이 그냥 '자본금'(총액)이면 되짚은 수가 총 주식수다.
  // 이때는 발행주식수와 바로 견준다. 라벨을 못 읽었으면 넘겨짚지 않는다 —
  // K-IFRS 는 발행주식수 == 보통주자본금÷액면가 라 여기서도 참이 되어 버린다.
  if (label && !/보통주/.test(label) && near(issued, impliedShares) && issued > preferred) return true

  return false
}

/**
 * 최대주주 지분율의 분모를 밝힌다.
 *
 * 감사보고서마다 분모가 다르다. 무하유는 2024년 보고서가 총주식수 기준 58.00%,
 * 2025년 보고서가 보통주 기준 67.94% 로 적었다(2025년 문장에만 "최대 주주(보통주)"
 * 라고 붙어 있다). 지분은 1주도 안 움직였는데 두 해를 나란히 놓으면 대주주가
 * 10%p 늘린 것처럼 보인다 — 실제로 그렇게 읽혔다.
 *
 * 그래서 문장의 숫자를 그대로 쓰지 않고, 우리가 아는 주식수로 두 기준을 모두
 * 계산한 뒤 문장이 어느 쪽인지 대조한다.
 */
function withOwnershipBasis(major, shares) {
  const held = major.shares
  const pct = (denom) => (held != null && denom ? (held / denom) * 100 : null)
  const ratioCommon = pct(shares.commonShares)
  const ratioTotal = pct(shares.totalShares)
  // 반올림·액면분할 잔차를 고려해 0.15%p 안이면 같은 기준으로 본다.
  const near = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.15

  // 우선주를 따로 인식하지 못했으면 두 기준이 같은 값이라 무엇으로 적혔는지 알 수 없다.
  // 그때 '보통주 기준' 이라고 단정하면 거짓말이 된다 — 일반기업회계기준 보고서는
  // 우선주를 발행주식수에 이미 포함해 적는다(무하유 2024년 23,429주).
  const distinguishable = ratioCommon != null && ratioTotal != null && !near(ratioCommon, ratioTotal)
  const statedBasis = !distinguishable
    ? null
    : near(major.ratio, ratioCommon)
      ? 'common'
      : near(major.ratio, ratioTotal)
        ? 'total'
        : null

  return { ...major, ratioStated: major.ratio ?? null, ratioCommon, ratioTotal, statedBasis }
}

/** "최대 주주 … 신동호는 2,717,600주(지분율 67.94%)" */
function findMajorShareholder(text) {
  const re = /최대\s*주주[^\n]{0,40}?([가-힣]{2,12})\s*(?:은|는|이|가)\s*([\d,]+)\s*주[^\n]{0,24}?([\d.]+)\s*%/
  const m = re.exec(text)
  if (m && !NOT_PERSON.test(m[1])) return { name: m[1], shares: parseAmount(m[2]), ratio: Number(m[3]), raw: m[0].trim() }

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
    if (NOT_PERSON.test(name)) return // "삼정회계법인" 같은 기관명
    seen.add(name)
    out.push({ name, role: role || null, shares: shares ?? null, ratio: ratio ?? null, raw })
  }

  // "…대표이사인 신동호는 2,717,600주(지분율 67.94%)의 주식을 보유"
  const re = new RegExp(
    `(?<![가-힣])(${ROLE})\\s*(?:인|이신|였던)?\\s*([가-힣]{2,6})\\s*(?:은|는|이|가)\\s*([\\d,]+)\\s*주(?:[^\\n]{0,24}?([\\d.]+)\\s*%)?`,
    'g'
  )
  let m
  while ((m = re.exec(text))) {
    push(m[2], m[1], parseAmount(m[3]), m[4] ? Number(m[4]) : null, m[0].trim())
  }

  // "신동호(대표이사)는 …주" 순서가 뒤집힌 표기
  const re2 = new RegExp(`([가-힣]{2,6})\\s*\\((${ROLE})\\)\\s*(?:은|는|이|가)?\\s*([\\d,]+)\\s*주`, 'g')
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
