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
  const primary = pickPrimaryBlocks(blocks, { ...meta, basis: resolvedBasis })
  const values = collectValues(primary)

  return {
    blocks,
    primary: Object.fromEntries(Object.entries(primary).map(([k, v]) => [k, v.id])),
    periods,
    values,
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
    values,
  }
}

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
  const cleaned = nums.filter((n, i) => {
    if (n.v === null) return true
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
function resolvePeriods(blocks, meta) {
  const hints = blocks.flatMap((b) => b.periodHints)
  let current = null
  let prior = null

  for (const h of hints) {
    const years = [...h.matchAll(/(20\d{2})/g)].map((m) => Number(m[1]))
    if (!years.length) continue
    const y = Math.max(...years)
    if (/\(?당\)?\s*기/.test(h) && current == null) current = y
    else if (/\(?전\)?\s*기/.test(h) && prior == null) prior = y
  }
  // 표 헤더에서 직접 읽은 연도가 표지 추정값보다 정확하다. 출처를 남겨 상위에서 판단하게 한다.
  const source = current != null ? 'statement' : 'meta'
  if (current == null) current = meta.fiscalYear
  if (prior == null && current != null) prior = current - 1
  // 원문에 오기가 있으면(전기 기간 종료일을 당기와 같게 적는 경우가 있다) 전기를 한 해 앞으로 둔다.
  if (current != null && prior != null && prior >= current) prior = current - 1

  const termNo = meta.termNo ?? extractTermNo(hints.join(' '))
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
  let c = 0
  let s = 0
  for (const b of scored) {
    if (b.basis === '연결') c += b.matchCount
    else s += b.matchCount
  }
  if (c === s) return meta.basis || '별도'
  return c > s ? '연결' : '별도'
}

/** 같은 종류의 블록이 여러 개면 계정 매칭이 가장 많은 것을 대표로 쓴다. */
function pickPrimaryBlocks(blocks, meta) {
  const preferred = meta.basis === '연결' ? '연결' : '별도'
  const out = {}
  for (const key of Object.keys(STATEMENTS)) {
    const candidates = blocks.filter((b) => b.stmt === key && b.matchCount > 0)
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
