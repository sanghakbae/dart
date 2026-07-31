// 문서 행 배열에서 재무제표 블록을 찾아내고, 계정과목 · 당기/전기 금액을 복원한다.
// 표 원문 행은 하나도 버리지 않고 blocks[].rows 에 그대로 보존한다(전체 내용 보기용).

import { parseAmount, detectUnit, extractTermNo } from './numbers.js'
import { SECTION_PATTERNS, STATEMENTS, matchAccount, normalizeLabel } from './taxonomy.js'

const MAX_BLOCK_GAP = 45 // 계정과목이 안 잡히는 행이 이만큼 이어지면 블록 종료

export function parseStatements(doc, meta) {
  const rows = doc.rows
  const blocks = []
  let cur = null
  let missStreak = 0
  let basis = meta.basis === '연결' ? '연결' : '별도'

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const text = row.text.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text) continue

    // 연결/별도 구분 전환
    if (/연결\s*재무제표|연결\s*재무상태표|연결\s*손익계산서/.test(text)) basis = '연결'
    else if (/별도\s*재무제표|^재무제표\s*$/.test(text)) basis = '별도'

    const head = detectSectionHead(text)
    if (head) {
      if (cur) blocks.push(finishBlock(cur))
      cur = {
        stmt: head.stmt,
        basis: head.basis || basis,
        headerText: text,
        unit: { factor: 1, label: '원', found: false },
        periodHints: [],
        rows: [],
        items: {},
        startIndex: i,
        page: row.page,
      }
      missStreak = 0
      continue
    }
    if (!cur) continue

    // 단위 표기와 기간 헤더 수집
    const unit = detectUnit(text)
    if (unit.found && !cur.unit.found) cur.unit = unit
    if (/제\s*\d{1,3}\s*\(?[당전]?\)?\s*기/.test(text)) {
      cur.periodHints.push(text)
      cur.rows.push({ label: text, values: [], kind: 'header', page: row.page })
      continue
    }

    const parsed = parseRow(row)

    // 긴 계정과목은 PDF 에서 두 줄로 접힌다("6. 유동성금융리스부채(주" / "97,729,519 77,067,029").
    // 앞줄이 라벨만, 이 줄이 숫자만이면 한 계정으로 잇는다.
    if (parsed.kind === 'numbersOnly' && cur.rows.length) {
      const prev = cur.rows[cur.rows.length - 1]
      if (prev.kind === 'text' && prev.label) {
        prev.kind = 'account'
        prev.values = parsed.values
        registerAccount(cur, prev.label, parsed.values)
        missStreak = 0
        continue
      }
    }

    cur.rows.push({ ...parsed, page: row.page })

    if (parsed.kind === 'account') {
      registerAccount(cur, parsed.label, parsed.values)
      missStreak = 0
    } else {
      missStreak++
      if (missStreak > MAX_BLOCK_GAP) {
        blocks.push(finishBlock(cur))
        cur = null
        missStreak = 0
      }
    }
  }
  if (cur) blocks.push(finishBlock(cur))

  const periods = resolvePeriods(blocks, meta)
  for (const b of blocks) applyUnit(b, periods)

  const resolvedBasis = resolveBasis(blocks, meta)
  const primary = pickPrimaryBlocks(blocks, resolvedBasis)
  const values = collectValues(primary)

  return {
    blocks,
    primary: Object.fromEntries(Object.entries(primary).map(([k, v]) => [k, v.id])),
    periods,
    values,
    valuesByBasis: collectValuesByBasis(blocks),
    basis: resolvedBasis,
  }
}

/**
 * 재무제표 제목 줄 판정.
 * DART 원문의 제목은 "재 무 상 태 표" 처럼 글자마다 공백이 들어가 있어,
 * 공백을 제거한 문자열로 비교해야 한다.
 */
function detectSectionHead(text) {
  if (text.length > 60) return null
  const squished = text.replace(/\s+/g, '')
  if (squished.length > 40) return null
  // "19. 현금흐름표" 같은 주석 표제는 재무제표 본표가 아니다.
  if (/^\d{1,2}[.)]/.test(squished)) return null
  if (/에(표시|대한|관한)|참조|주석|첨부/.test(squished)) return null

  for (const p of SECTION_PATTERNS) {
    const m = p.re.exec(squished)
    if (!m) continue
    // 제목은 줄 앞머리에 온다("연결" 정도만 앞에 붙는다).
    if (m.index > 4) continue
    // 제목 뒤에는 기간·단위 표기만 올 수 있다.
    // 주석의 "재무상태표 상 자산 | 당기말 | …" 같은 줄을 본표로 오인하지 않게 한다.
    const rest = squished.slice(m.index + m[0].length)
    if (rest && !/^(제\d|20\d{2}|\(|단위|및)/.test(rest)) continue
    // 연결 여부는 본문 언급이 아니라 이 제목으로 판단한다.
    // (별도 보고서의 주석에도 "연결재무제표" 라는 말은 흔히 나온다)
    return { stmt: p.stmt, basis: /^연결/.test(squished.slice(m.index)) ? '연결' : '별도' }
  }
  return null
}

/** 계정과목 사전에 매칭되면 블록의 items 에 등록한다(먼저 나온 값을 유지). */
function registerAccount(block, label, values) {
  const acct = matchAccount(label, block.stmt)
  if (!acct || block.items[acct.key] !== undefined) return
  block.items[acct.key] = {
    key: acct.key,
    label: acct.label,
    rawLabel: label,
    level: acct.level,
    perShare: Boolean(acct.perShare),
    // 「영업손실 4,118,907,794」 처럼 라벨이 손실인데 숫자가 양수인 서식이 있다.
    // 그대로 두면 적자가 흑자로 뒤집힌다. 이미 음수면 두 번 뒤집지 않는다.
    values: acct.negate ? values.map(negateIfPositive) : values,
  }
}

const negateIfPositive = (v) => (typeof v === 'number' && v > 0 ? -v : v)

const DASH_ONLY = /^[-–—－ㅡ]$/

/** 한 행을 { kind, label, values[] } 로 정규화한다. */
function parseRow(row) {
  const cells = row.cells.filter((c) => c !== '')
  if (!cells.length) return { kind: 'blank', label: '', values: [] }

  const nums = []
  const labelParts = []
  cells.forEach((c) => {
    const raw = String(c).trim()
    const v = parseAmount(raw)
    if (v !== null) {
      nums.push({ v, raw })
    } else if (DASH_ONLY.test(raw)) {
      // "-" 는 값이 없다는 표기다. 자리를 비워두지 않으면 당기/전기 열이 밀린다.
      nums.push({ v: null, raw })
    } else {
      labelParts.push(raw)
    }
  })

  // 주석 참조 열 제거: 오른쪽에 다른 숫자가 있는 '쉼표 없는 두 자리 이하 정수'
  //
  // 0 은 빼야 한다. 주석 번호는 1 부터 시작하므로 0 은 언제나 금액이고,
  // 이걸 지우면 뒤의 열이 통째로 한 칸씩 당겨진다 — 아이스크림에듀 2025년
  // 비지배지분 행 「0 | 5,508,371 | 436,660,121」 이 당기 5,508,371 로 뒤집혔다.
  const cleaned = nums.filter((n, i) => {
    if (n.v === null || n.v === 0) return true
    const isNoteRef = /^\(?\s*\d{1,2}\s*\)?$/.test(n.raw) && !n.raw.includes(',')
    return !(isNoteRef && i < nums.length - 1)
  })
  const picked = cleaned.length ? cleaned : nums
  const values = picked.map((n) => n.v)
  const hasNumber = picked.some((n) => n.v !== null)

  const label = labelParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!label) return { kind: hasNumber ? 'numbersOnly' : 'blank', label: '', values: hasNumber ? values : [] }
  if (!hasNumber) return { kind: 'text', label, values: [] }
  return { kind: 'account', label, values }
}

function finishBlock(b) {
  b.id = `${b.stmt}:${b.basis}:${b.startIndex}`
  b.matchCount = Object.keys(b.items).length
  b.label = `${b.basis}${STATEMENTS[b.stmt].label}`
  return b
}

/**
 * 당기 · 전기 연도를 확정한다.
 * 블록 헤더의 "제25(당)기 2024.01.01~2024.12.31" 를 우선 신뢰하고,
 * 없으면 표지에서 찾은 사업연도를 기준으로 -1 년을 전기로 본다.
 */
export function resolvePeriods(blocks, meta) {
  const hints = blocks.flatMap((b) => b.periodHints)

  // periodHints 에는 기간 헤더뿐 아니라 핵심감사사항 같은 서술 문단이 통째로 섞여 든다.
  // 그 안의 "2024년 12월 31일 현재 … 당기말 재고자산 …" 같은 문장을 당기=2024 로
  // 잘못 물어, 2025 사업보고서의 당기가 2024 로 뒤집혔다.
  //
  // 그래서 '제 N 기' 바로 뒤에 붙는 날짜만 기간으로 인정한다. 서술 문단은 제N기와
  // 연도가 멀찍이 떨어져 있어 자연히 걸러진다.
  const byTerm = new Map()
  const re = /제\s*(\d+)\s*(?:\(\s*[당전]\s*\)|[당전])?\s*기\s*(?:\(\s*[당전]\s*\)\s*)?(\d{4})[.\-/]\s*\d{1,2}/g
  for (const h of hints) {
    for (const m of h.matchAll(re)) {
      const term = Number(m[1])
      const year = Number(m[2])
      if (!byTerm.has(term)) byTerm.set(term, year)
    }
  }

  let current = null
  let prior = null
  let source = 'meta'
  let termNo = meta.termNo ?? null

  if (byTerm.size) {
    // 보고 대상 기(期)는 가장 높은 회차다. 표지의 termNo 가 있으면 그걸 우선한다.
    const terms = [...byTerm.keys()].sort((a, b) => b - a)
    termNo = termNo && byTerm.has(termNo) ? termNo : terms[0]
    current = byTerm.get(termNo)
    prior = byTerm.get(termNo - 1) ?? (current != null ? current - 1 : null)
    source = 'statement'
  } else {
    // 헤더를 못 찾으면 옛 방식: '당기'/'전기' 라벨이 붙은 줄에서 연도를 줍는다.
    for (const h of hints) {
      const years = [...h.matchAll(/(20\d{2})/g)].map((x) => Number(x[1]))
      if (!years.length) continue
      const y = Math.max(...years)
      if (/\(\s*당\s*\)\s*기|당\s*기/.test(h) && current == null) current = y
      else if (/\(\s*전\s*\)\s*기|전\s*기/.test(h) && prior == null) prior = y
    }
    source = current != null ? 'statement' : 'meta'
  }

  if (current == null) current = meta.fiscalYear
  if (prior == null && current != null) prior = current - 1
  // 원문 오기(전기 종료일을 당기와 같게 적는 경우)를 바로잡는다.
  if (current != null && prior != null && prior >= current) prior = current - 1
  if (termNo == null) termNo = extractTermNo(hints.join(' '))

  return [
    { id: 'current', year: current, label: current ? `${current}년` : '당기', termNo, which: '당기', source },
    { id: 'prior', year: prior, label: prior ? `${prior}년` : '전기', termNo: termNo ? termNo - 1 : null, which: '전기', source },
  ]
}

function applyUnit(block, periods) {
  const f = block.unit.factor || 1
  block.unitFactor = f
  for (const item of Object.values(block.items)) {
    // 주당금액은 단위 표기(천원 등)를 따르지 않고 원 단위로 표시되는 것이 관례다.
    const factor = item.perShare ? 1 : f
    item.scaled = periods.map((_, i) => (item.values[i] != null ? item.values[i] * factor : null))
    item.current = item.scaled[0]
    item.prior = item.scaled[1]
  }
  for (const r of block.rows) {
    if (r.kind === 'account' && r.values.length) {
      r.scaled = r.values.map((v) => (v == null ? null : v * f))
    }
  }
}

/**
 * 연결/별도 판정. 본문 언급("연결재무제표는 …")이 아니라 실제 본표 제목을 센다.
 * 별도 보고서의 주석에도 연결 이야기가 나오므로 텍스트 검색만으로는 뒤집힌다.
 */
function resolveBasis(blocks, meta) {
  const scored = blocks.filter((b) => b.matchCount > 0)
  if (!scored.length) return meta.basis || '별도'

  // 사업보고서에는 연결과 별도가 나란히 실린다. 계정 수로 겨루면 해마다 뒤집혔다
  // (SK하이닉스가 2023년 연결, 2025년 별도로 갈렸다 — 같은 서식인데).
  // 연결재무제표를 작성하는 회사는 그쪽이 주재무제표이므로, 연결 본표가 제대로
  // 잡혔으면 연결로 본다. 별도만 있는 보고서는 그대로 별도다.
  if (scored.some((b) => b.basis === '연결')) return '연결'
  return '별도'
}

/**
 * 기준별 수치 한 벌씩.
 *
 * 사업보고서에는 연결과 별도가 나란히 실린다. 대표 기준 한 벌만 남기면 다른 기준의
 * 수치가 통째로 버려져, 추이에서 그 연도만 비어 보인다 — 아이스크림에듀는 별도가
 * 2021~2025 년 내내 있는데도 2023·2024 사업보고서가 '연결' 로 분류돼 별도 추이에
 * 두 해가 뚫렸다. 어느 쪽을 볼지는 화면에서 고르므로, 여기서는 있는 대로 다 담는다.
 */
function collectValuesByBasis(blocks) {
  const out = {}
  for (const basis of ['연결', '별도']) {
    const primary = pickPrimaryBlocks(blocks, basis, { strict: true })
    if (!Object.keys(primary).length) continue
    const values = collectValues(primary)
    if (Object.keys(values).length) out[basis] = values
  }
  return out
}

/**
 * 같은 종류의 블록이 여러 개면 계정 매칭이 가장 많은 것을 대표로 쓴다.
 * strict 면 고른 기준의 블록만 본다(기준별 수치를 따로 뽑을 때).
 */
function pickPrimaryBlocks(blocks, basis, { strict = false } = {}) {
  const preferred = basis === '연결' ? '연결' : '별도'
  const out = {}
  for (const key of Object.keys(STATEMENTS)) {
    let candidates = blocks.filter((b) => b.stmt === key && b.matchCount > 0)
    if (strict) candidates = candidates.filter((b) => b.basis === preferred)
    if (!candidates.length) continue
    candidates.sort((a, b) => {
      const pa = a.basis === preferred ? 1 : 0
      const pb = b.basis === preferred ? 1 : 0
      return pb - pa || b.matchCount - a.matchCount || a.startIndex - b.startIndex
    })
    out[key] = candidates[0]
  }
  return out
}

/** 대표 블록들의 계정을 하나의 { key: {current, prior} } 맵으로 합치고 파생계정을 채운다. */
function collectValues(primary) {
  const v = {}
  for (const block of Object.values(primary)) {
    for (const item of Object.values(block.items)) {
      if (v[item.key] === undefined) {
        v[item.key] = { current: item.current ?? null, prior: item.prior ?? null, label: item.label, level: item.level }
      }
    }
  }

  const derive = (key, label, fn) => {
    const cur = fn('current')
    const pri = fn('prior')
    if (cur == null && pri == null) return
    if (v[key] && (v[key].current != null || v[key].prior != null)) return
    v[key] = { current: cur, prior: pri, label, level: 0, derived: true }
  }
  const g = (k, p) => (v[k] ? v[k][p] : null)
  const sub = (a, b, p) => (g(a, p) != null && g(b, p) != null ? g(a, p) - g(b, p) : null)
  const add = (a, b, p) => (g(a, p) != null && g(b, p) != null ? g(a, p) + g(b, p) : null)

  // 매출총이익은 '매출원가'가 있을 때만 의미가 있다.
  // 영업수익/영업비용 구조에서 revenue - operatingExpense 는 매출총이익이 아니라 영업이익이다.
  derive('grossProfit', '매출총이익', (p) => sub('revenue', 'cogs', p))
  derive('operatingProfit', '영업이익', (p) => sub('grossProfit', 'sgna', p) ?? sub('revenue', 'operatingExpense', p))
  derive('totalAssets', '자산총계', (p) => add('currentAssets', 'nonCurrentAssets', p))
  derive('totalLiabilities', '부채총계', (p) => add('currentLiabilities', 'nonCurrentLiabilities', p))
  derive('totalEquity', '자본총계', (p) => sub('totalAssets', 'totalLiabilities', p))
  derive('netIncome', '당기순이익', (p) => sub('pretaxProfit', 'incomeTax', p))

  return v
}
