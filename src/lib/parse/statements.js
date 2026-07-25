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
        basis,
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
    cur.rows.push({ ...parsed, page: row.page })

    if (parsed.kind === 'account') {
      const acct = matchAccount(parsed.label, cur.stmt)
      if (acct && cur.items[acct.key] === undefined) {
        cur.items[acct.key] = {
          key: acct.key,
          label: acct.label,
          rawLabel: parsed.label,
          level: acct.level,
          perShare: Boolean(acct.perShare),
          values: parsed.values,
        }
      }
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

  const primary = pickPrimaryBlocks(blocks, meta)
  const values = collectValues(primary)

  return { blocks, primary: Object.fromEntries(Object.entries(primary).map(([k, v]) => [k, v.id])), periods, values }
}

function detectSectionHead(text) {
  if (text.length > 60) return null
  // "재무상태표" 만 있는 제목 줄, 또는 "연결재무상태표 제25기 ..." 형태
  for (const p of SECTION_PATTERNS) {
    const m = p.re.exec(text)
    if (!m) continue
    const before = text.slice(0, m.index).trim()
    // 문장 중간 언급("...재무상태표에 표시된...")은 제목으로 보지 않는다.
    if (before.length > 12) continue
    if (/에\s*(표시|대한|관한)|참조|주석/.test(text)) continue
    return { stmt: p.stmt }
  }
  return null
}

/** 한 행을 { kind, label, values[] } 로 정규화한다. */
function parseRow(row) {
  const cells = row.cells.filter((c) => c !== '')
  if (!cells.length) return { kind: 'blank', label: '', values: [] }

  const nums = []
  const labelParts = []
  cells.forEach((c, idx) => {
    const v = parseAmount(c)
    if (v !== null) nums.push({ v, idx, raw: c })
    else labelParts.push(c)
  })

  // 주석 참조 열 제거: 오른쪽에 다른 숫자가 있는 '쉼표 없는 두 자리 이하 정수'
  const cleaned = nums.filter((n, i) => {
    const isNoteRef = /^\(?\s*\d{1,2}\s*\)?$/.test(n.raw.trim()) && !n.raw.includes(',')
    return !(isNoteRef && i < nums.length - 1)
  })
  const values = (cleaned.length ? cleaned : nums).map((n) => n.v)

  const label = labelParts.join(' ').replace(/\s+/g, ' ').trim()
  if (!label) return { kind: values.length ? 'numbersOnly' : 'blank', label: '', values }
  if (!values.length) return { kind: 'text', label, values: [] }
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
  if (current == null) current = meta.fiscalYear
  if (prior == null && current != null) prior = current - 1

  const termNo = meta.termNo ?? extractTermNo(hints.join(' '))
  return [
    { id: 'current', year: current, label: current ? `${current}년` : '당기', termNo, which: '당기' },
    { id: 'prior', year: prior, label: prior ? `${prior}년` : '전기', termNo: termNo ? termNo - 1 : null, which: '전기' },
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
      r.scaled = r.values.map((v) => v * f)
    }
  }
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

  derive('grossProfit', '매출총이익', (p) => sub('revenue', 'cogs', p))
  derive('operatingProfit', '영업이익', (p) => sub('grossProfit', 'sgna', p))
  derive('totalAssets', '자산총계', (p) => add('currentAssets', 'nonCurrentAssets', p))
  derive('totalLiabilities', '부채총계', (p) => add('currentLiabilities', 'nonCurrentLiabilities', p))
  derive('totalEquity', '자본총계', (p) => sub('totalAssets', 'totalLiabilities', p))
  derive('netIncome', '당기순이익', (p) => sub('pretaxProfit', 'incomeTax', p))

  return v
}
