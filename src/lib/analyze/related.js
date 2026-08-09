// 주석에서 투자 실사에 꼭 보는 두 가지를 꺼낸다.
//
//   특수관계자 거래 — 매출의 상당 부분이 모회사·관계사에서 나오면 그건 성장이 아니라
//                     배분이다. 매출의 質을 가르는데 재무제표 본문에는 안 나온다.
//   우발상황       — 소송·지급보증·담보제공은 재무상태표에 안 잡히는 부채다.
//
// 주석 표는 셀 병합 때문에 "공동기업(*1) 카피모니터㈜" 처럼 여러 열이 한 칸에 뭉쳐 온다.
// 그래서 숫자를 단정하지 않는다 — 열 제목에 '매출' 이 있는 열만 보수적으로 더하고,
// 화면에는 근거가 된 원문 표를 항상 함께 보여 준다.

const NUM = /^\(?-?[\d,]+\)?$/

/** "1,234" · "(1,234)" · "-" → 숫자 (괄호는 음수) */
export function cellAmount(text) {
  const s = String(text ?? '').trim()
  if (!s || s === '-' || !NUM.test(s)) return null
  const neg = s.startsWith('(')
  const n = Number(s.replace(/[(),]/g, ''))
  if (!Number.isFinite(n)) return null
  return neg ? -n : n
}

/**
 * 주석 표의 금액 단위.
 *
 * 주석은 대개 천원 단위인데 재무제표 본문은 원 단위다. 그대로 나누면 비중이 1000배
 * 어긋난다 — 우리에프아이에스(우리금융 계열 IT)가 "특수관계자 매출 0.1%" 로 나왔다.
 * 단위는 표 바로 앞 문단에 "(단위:천원)" 으로 적혀 있으므로 표마다 거슬러 찾는다.
 * 못 찾으면 곱하지 않고 아예 비중을 내지 않는다 — 틀린 숫자보다 없는 편이 낫다.
 */
const UNIT_SCALE = [
  { re: /백만\s*원/, scale: 1_000_000 },
  { re: /천\s*원/, scale: 1_000 },
  { re: /억\s*원/, scale: 100_000_000 },
  // 앞의 백만원·천원·억원을 먼저 거르므로 여기 남은 '원' 은 단위가 원이라는 뜻이다.
  // (\b 는 한글에 걸리지 않는다 — \w 기준이라 "원" 앞뒤로 경계가 생기지 않는다)
  { re: /원/, scale: 1 },
]

export function unitScaleOf(text) {
  const m = /\(?\s*단위\s*[::]?\s*([^)\n]{0,12})\)?/.exec(String(text || ''))
  if (!m) return null
  const hit = UNIT_SCALE.find((u) => u.re.test(m[1]))
  return hit ? hit.scale : null
}

/** 표 바로 앞 문단들에서 단위를 찾는다. 가까운 것이 그 표의 단위다. */
function scaleForTable(blocks, index) {
  for (let i = index - 1; i >= 0 && i >= index - 3; i--) {
    const b = blocks[i]
    if (b?.type !== 'p') continue
    // 문단이 길면 끝부분에 붙은 단위 표기가 그 표의 것이다.
    const s = unitScaleOf(String(b.text || '').slice(-400))
    if (s) return s
  }
  return null
}

const RELATED_TITLE = /특수관계자/
const CONTINGENT_TITLE = /우발|약정|담보|보증|소송/

/** 열 제목이 매출 성격인가. '매입' 이 섞인 열은 반대 방향이라 뺀다. */
function isRevenueColumn(header) {
  const h = String(header || '')
  return /매출/.test(h) && !/매입/.test(h)
}

/**
 * 행 라벨이 매출 성격인가.
 * 표 대부분은 열 제목이 비어 오고("당기/전기" 뿐이거나 아예 null) 계정과목이 행에 있다.
 * 매출채권은 잔액이고 매출원가는 반대 방향이라 둘 다 뺀다.
 */
function isRevenueRow(label) {
  const s = String(label || '').replace(/\s+/g, '')
  if (!/매출|수익/.test(s)) return false
  return !/매출채권|매출원가|매입|미수|선수/.test(s)
}

/** 행에서 첫 번째로 나오는 숫자 = 당기 값. 표 대부분이 당기·전기 순이다. */
function firstAmount(row) {
  for (let i = 1; i < row.length; i++) {
    const v = cellAmount(row[i])
    if (v != null) return v
  }
  return null
}

/**
 * 특수관계자 주석에서 거래 표와 매출 성격 합계를 뽑는다.
 *
 * @param {object} notes  { items: [{no,title,body,content}] }
 * @param {number|null} revenue 당기 매출액 — 비중 계산용
 */
export function extractRelatedParty(notes, revenue) {
  const items = notes?.items || []
  const note = items.find((i) => RELATED_TITLE.test(i.title || ''))
  if (!note) return null

  const blocks = note.content || []
  const tables = blocks.filter((b) => b.type === 'table' && b.rows?.length)
  // 표마다 단위가 다를 수 있어 블록 위치로 각각 찾는다.
  const scaleOf = (table) => scaleForTable(blocks, blocks.indexOf(table))

  // 1차: 열 제목이 매출인 열을 더한다. 채권·채무 표까지 더하면 뜻이 달라지므로
  // 매출 열이 있는 표만 대상으로 한다.
  let revenueFromRelated = null
  let method = null
  const counterparties = []
  for (const t of tables) {
    const cols = (t.header || []).map((h, i) => ({ i, header: h, revenue: isRevenueColumn(h) }))
    const revCols = cols.filter((c) => c.revenue)
    if (!revCols.length) continue

    const scale = scaleOf(t)
    if (scale == null) continue // 단위를 모르면 더하지 않는다
    for (const row of t.rows) {
      const name = String(row[0] ?? '').trim()
      if (!name) continue
      let sum = null
      for (const c of revCols) {
        const v = cellAmount(row[c.i])
        if (v == null) continue
        sum = (sum || 0) + v * scale
      }
      if (sum == null) continue
      counterparties.push({ name, amount: sum, columns: revCols.map((c) => c.header) })
      revenueFromRelated = (revenueFromRelated || 0) + sum
    }
  }
  if (counterparties.length) method = 'column'

  // 2차: 열 제목이 비어 오는 표가 훨씬 많다("당기/전기" 뿐이거나 아예 null).
  // 그럴 땐 계정과목이 행에 있으므로 행 라벨로 찾고, 당기 값(첫 숫자)만 쓴다.
  if (!counterparties.length) {
    for (const t of tables) {
      // 열 제목이 잔액성이면(당기말/전기말) 거래가 아니라 채권·채무 표다.
      if ((t.header || []).some((h) => /기말/.test(String(h || '')))) continue
      const scale = scaleOf(t)
      if (scale == null) continue
      for (const row of t.rows) {
        const label = String(row[0] ?? '').trim()
        if (!isRevenueRow(label)) continue
        const v = firstAmount(row)
        if (v == null || v <= 0) continue
        counterparties.push({ name: label, amount: v * scale, columns: ['당기'] })
        revenueFromRelated = (revenueFromRelated || 0) + v * scale
      }
    }
    if (counterparties.length) method = 'row'
  }

  const share =
    revenueFromRelated != null && revenue ? (revenueFromRelated / revenue) * 100 : null

  return {
    no: note.no,
    title: note.title,
    body: note.body || '',
    tables,
    counterparties: counterparties.sort((a, b) => b.amount - a.amount),
    revenueFromRelated,
    // 어떻게 구한 값인지. 화면에서 근거를 밝히는 데 쓴다.
    method,
    revenue: revenue ?? null,
    share,
    // 비중이 크면 매출이 한 곳에 묶여 있다는 뜻이다. 결론이 아니라 확인할 지점이다.
    heavy: share != null && share >= 20,
  }
}

/** 우발상황에서 찾을 유형. 앞의 것이 더 구체적이라 먼저 맞춘다. */
const KINDS = [
  { kind: '소송', re: /소송|피소|손해배상|가처분|중재/ },
  { kind: '지급보증', re: /지급\s*보증|연대\s*보증|보증을?\s*제공/ },
  { kind: '담보제공', re: /담보(로|를)?\s*제공|근저당|질권/ },
  { kind: '약정', re: /약정|한도\s*대출|당좌차월|여신/ },
]

/**
 * "계류 중인 소송은 존재하지 않습니다" 는 위험이 아니라 그 반대다.
 * 부정문을 걸러내지 않으면 소송 없는 회사가 소송 1건으로 표시된다.
 */
const NEGATED =
  /(존재하지\s*않|없습니다|없으며|없음|해당\s*사항\s*(이)?\s*없|제공하고\s*있지\s*않|체결하고\s*있지\s*않)/

/** 문장 단위로 잘라 해당 유형이 언급된 것만 남긴다. 문단 통째로 실으면 읽히지 않는다. */
function sentencesOf(text) {
  return String(text || '')
    .split(/(?<=[.。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
}

/**
 * 우발상황·약정 주석에서 소송·보증·담보·약정 언급을 꺼낸다.
 * @param {object} notes
 */
export function extractContingencies(notes) {
  const items = notes?.items || []
  const notesFound = items.filter((i) => CONTINGENT_TITLE.test(i.title || ''))
  if (!notesFound.length) return null

  const found = []
  for (const note of notesFound) {
    const text = note.body || ''
    for (const s of sentencesOf(text)) {
      const hit = KINDS.find((k) => k.re.test(s))
      if (!hit) continue
      // 같은 문장이 여러 주석에 반복되면 한 번만 싣는다.
      if (found.some((f) => f.text === s)) continue
      found.push({ kind: hit.kind, text: s, no: note.no, title: note.title, absent: NEGATED.test(s) })
    }
  }

  const present = found.filter((f) => !f.absent)
  return {
    notes: notesFound.map((n) => ({ no: n.no, title: n.title, body: n.body || '', content: n.content || [] })),
    items: found,
    // 실제로 존재한다고 적힌 것만. 배지·건수는 이걸로 센다.
    present,
    absent: found.filter((f) => f.absent),
    kinds: [...new Set(present.map((f) => f.kind))],
    // 언급이 하나도 안 걸려도 주석 자체는 보여 준다 — "없음" 과 "못 찾음" 은 다르다.
    empty: found.length === 0,
  }
}
