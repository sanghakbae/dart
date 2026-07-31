// 조달청 나라장터 프록시 — 공공조달 낙찰 실적.
//
//   GET /api/g2b/awards?bizNo=1234567890[&name=무하유][&months=12]
//
// 왜 필요한가 — 비상장사는 매출을 뒷받침할 외부 근거가 거의 없다. 공공조달 낙찰은
// 금액·발주기관·시점이 기관 자료로 남는 유일한 실적이다. 감사보고서의 매출이
// 어디서 나온 것인지 짚을 수 있다.
//
// 주의할 점
//  - 조회 기간에 **1개월 제한**이 있다. 그래서 월 단위로 잘라 여러 번 부른다.
//    한 회사 12개월이면 상류 12회 + 페이지 몇 번이다 — 자동 조회하지 않는 이유.
//  - 표준 데이터셋 경로가 두 갈래로 돌아다닌다(`/1230000/ao/…` · `/1230000/…`).
//    앞의 것으로 부르고 경로 오류면 뒤의 것으로 한 번 더 시도한다.
//  - 인증키는 '디코딩' 키를 넣는다(searchParams 가 한 번 인코딩한다).
//  - 낙찰자 필터가 상류에서 부분일치로 걸릴 수 있어, 받은 뒤 사업자번호·상호로 한 번 더 거른다.
//  - 사업자번호가 있으면 그것만 쓴다. 상호는 표기가 갈려(주식회사 유무) 헛것이 섞인다.

import { nameVariants, normName } from './company-name.mjs'

/** 표준 데이터셋(낙찰정보) 후보 경로. 앞에서부터 시도한다. */
const BASES = [
  'http://apis.data.go.kr/1230000/ao/PubDataOpnStdService',
  'http://apis.data.go.kr/1230000/PubDataOpnStdService',
]
const OP = 'getDataSetOpnStdScsbidInfo'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const TIMEOUT = 20_000
const PAGE_SIZE = 100
/** 한 달 구간에서 넘길 페이지 상한. 한 회사가 한 달에 100건을 넘는 일은 드물다. */
const MAX_PAGES_PER_MONTH = 3
/** 한 번의 조회에서 쓸 상류 호출 총 상한. 조달청도 일 트래픽 제한이 있다. */
const MAX_CALLS = 48
/** 기본 조회 기간(개월). */
const DEFAULT_MONTHS = 12
const MAX_MONTHS = 60

export function g2bCors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })

/** 후보 키 중 값이 있는 첫 번째. 표준 데이터셋과 낙찰정보서비스의 필드명이 조금씩 다르다. */
function any(row, keys) {
  for (const k of keys) {
    const v = row?.[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}

function num(v) {
  const n = Number(String(v || '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD HH:MM:SS' · 'YYYYMMDDHHMM' 등을 YYYY-MM-DD 로. */
export function toDate(s) {
  const v = String(s || '').replace(/\D/g, '')
  return v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : null
}

/** 상류 한 건 → 화면이 쓰는 모양. */
export function mapAward(row = {}) {
  return {
    bidNo: any(row, ['bidNtceNo', 'bidNtceNoOrd', 'ntceNo']),
    order: any(row, ['bidNtceOrd', 'ntceOrd']) || null,
    title: any(row, ['bidNtceNm', 'ntceNm', 'prdctClsfcNoNm']),
    // 공고기관과 수요기관이 다른 경우가 많다(조달청이 공고, 실제 발주는 지자체).
    noticeInstitution: any(row, ['ntceInsttNm', 'ntceInsttNmKor']) || null,
    demandInstitution: any(row, ['dminsttNm', 'dmndInsttNm']) || null,
    openedAt: toDate(any(row, ['opengDt', 'opengDate', 'rlOpengDt'])),
    amount: num(any(row, ['sucsfbidAmt', 'scsbidAmt', 'sucsfbidPrice'])),
    rate: num(any(row, ['sucsfbidRate', 'scsbidRate'])),
    winner: any(row, ['bidwinnrNm', 'scsbidCorpNm', 'opengCorpNm']),
    winnerBizNo: any(row, ['bidwinnrBizno', 'scsbidCorpBizno', 'bidwinnrBizNo']).replace(/\D/g, '') || null,
  }
}

/** 상류 응답에서 목록을 꺼낸다. items 가 배열일 때도 { item: [] } 일 때도 있다. */
export function rowsOf(body) {
  const b = body?.response?.body ?? body?.body ?? body
  const items = b?.items ?? b?.item ?? []
  if (Array.isArray(items)) return items
  if (Array.isArray(items.item)) return items.item
  if (items && typeof items === 'object') return [items]
  return []
}

/** 상류 오류 → 문구. 오류가 아니면 null. */
export function upstreamError(body, status) {
  const h = body?.response?.header ?? body?.header
  const code = h?.resultCode ?? body?.resultCode
  const msg = h?.resultMsg ?? body?.resultMsg ?? body?.returnAuthMsg ?? ''
  if (code !== undefined && String(code).replace(/^0+/, '') === '') return null // 00 · 0
  if (code === undefined) return status >= 400 ? `HTTP ${status}` : null
  if (String(msg).includes('NORMAL')) return null
  return `${code} ${msg}`.trim()
}

/** 경로 자체가 틀렸을 때만 다음 후보 경로로 넘어간다(키·파라미터 오류는 넘기지 않는다). */
function looksLikeWrongPath(err, status) {
  return status === 404 || /SERVICE.*NOT.*FOUND|NOT_FOUND_SERVICE|등록되지 않은 서비스/i.test(String(err || ''))
}

/** YYYYMMDDHHMM */
function stamp(d, end) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${end ? '2359' : '0000'}`
}

/**
 * 조회할 월 구간. 상류가 1개월까지만 받으므로 달마다 하나씩 만든다.
 * 최근 달이 앞에 온다 — 상한(MAX_CALLS)에 걸려 잘리더라도 최근 것이 남는다.
 */
export function monthWindows(months, now = new Date()) {
  const out = []
  for (let i = 0; i < months; i++) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 0))
    out.push({ from: stamp(from, false), to: stamp(to, true) })
  }
  return out
}

/**
 * @param {Request} req
 * @param {string} key 공공데이터포털 인증키(디코딩)
 * @returns {Promise<Response|null>}
 */
export async function handleG2b(req, key) {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/g2b/')) return null

  const cors = g2bCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!key) return json({ error: 'G2B_API_KEY 가 서버에 설정되지 않았습니다.' }, 500, cors)

  const op = url.pathname.slice('/api/g2b/'.length)
  if (op !== 'awards') return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)

  const bizNo = (url.searchParams.get('bizNo') || '').replace(/\D/g, '')
  const name = url.searchParams.get('name') || ''
  if (bizNo.length !== 10 && !name) {
    return json({ error: '사업자등록번호(bizNo) 또는 회사명(name)이 필요합니다.' }, 400, cors)
  }

  const months = Math.min(MAX_MONTHS, Math.max(1, Number(url.searchParams.get('months')) || DEFAULT_MONTHS))
  const windows = monthWindows(months)

  try {
    const state = { calls: 0, base: 0 }
    // 사업자번호가 있으면 그것만 쓴다 — 상호보다 정확하고 호출도 한 벌로 끝난다.
    const queries =
      bizNo.length === 10
        ? [{ kind: 'bizNo', value: bizNo }]
        : candidates(name).map((v) => ({ kind: 'name', value: v }))

    for (const q of queries) {
      const r = await collect(q, windows, key, state)
      if (r.error) return json({ error: r.error }, 502, cors)
      if (r.awards.length) return json({ query: q.value, months, ...r }, 200, cors)
      if (state.calls >= MAX_CALLS) break
    }

    return json(
      { query: bizNo || name, months, total: 0, amount: 0, awards: [], byYear: [], truncated: state.calls >= MAX_CALLS },
      200,
      cors
    )
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

/** 찾아볼 상호. KIPRIS 와 같은 이유로 등기 상호 표기를 함께 시도한다. */
function candidates(company) {
  const out = []
  const seen = new Set()
  for (const v of nameVariants(company)) {
    const bare = normName(v)
    if (!bare || seen.has(bare)) continue
    seen.add(bare)
    out.push(bare)
  }
  return out
}

async function collect(q, windows, key, state) {
  const awards = []
  let truncated = false

  for (const w of windows) {
    for (let page = 1; page <= MAX_PAGES_PER_MONTH; page++) {
      if (state.calls >= MAX_CALLS) return finish(awards, true)
      const { body, error } = await call(q, w, page, key, state)
      if (error) return { error }

      const all = rowsOf(body)
      awards.push(...all.map(mapAward).filter((a) => mine(a, q)))

      if (all.length < PAGE_SIZE) break
      if (page === MAX_PAGES_PER_MONTH) truncated = true
    }
  }
  return finish(awards, truncated || state.calls >= MAX_CALLS)
}

/** 상류 한 번. 경로 후보를 순서대로 시도한다. */
async function call(q, w, page, key, state) {
  for (; state.base < BASES.length; state.base++) {
    const target = new URL(`${BASES[state.base]}/${OP}`)
    target.searchParams.set('serviceKey', key)
    target.searchParams.set('type', 'json')
    target.searchParams.set('numOfRows', String(PAGE_SIZE))
    target.searchParams.set('pageNo', String(page))
    // 1 = 개찰일시 기준. 낙찰 시점으로 모아야 연도별 실적이 맞는다.
    target.searchParams.set('inqryDiv', '1')
    target.searchParams.set('inqryBgnDt', w.from)
    target.searchParams.set('inqryEndDt', w.to)
    if (q.kind === 'bizNo') target.searchParams.set('bidwinnrBizno', q.value)
    else target.searchParams.set('bidwinnrNm', q.value)

    state.calls++
    const res = await fetch(target, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) })
    const text = await res.text()

    let body
    try {
      body = JSON.parse(text)
    } catch {
      // 오류는 XML·HTML 로 오는 경우가 있다. 경로가 틀린 것이면 다음 후보로 넘어간다.
      if (looksLikeWrongPath(text, res.status) && state.base < BASES.length - 1) continue
      return { error: `응답을 해석할 수 없습니다 (${res.status})` }
    }

    const err = upstreamError(body, res.status)
    if (err) {
      if (looksLikeWrongPath(err, res.status) && state.base < BASES.length - 1) continue
      return { error: `조달청 조회 실패: ${err}` }
    }
    return { body }
  }
  return { error: '조달청 표준 데이터셋 경로를 찾지 못했습니다.' }
}

/** 상류 필터가 부분일치일 수 있어 한 번 더 거른다. */
function mine(a, q) {
  if (q.kind === 'bizNo') return !a.winnerBizNo || a.winnerBizNo === q.value
  return normName(a.winner) === normName(q.value)
}

function finish(awards, truncated) {
  const seen = new Set()
  const unique = awards.filter((a) => {
    const k = `${a.bidNo}-${a.order || ''}`
    return seen.has(k) ? false : seen.add(k)
  })
  unique.sort((a, b) => String(b.openedAt || '').localeCompare(String(a.openedAt || '')))

  const byYear = new Map()
  let amount = 0
  for (const a of unique) {
    amount += a.amount || 0
    const y = Number(String(a.openedAt || '').slice(0, 4))
    if (!Number.isFinite(y)) continue
    const cur = byYear.get(y) || { year: y, count: 0, amount: 0 }
    cur.count++
    cur.amount += a.amount || 0
    byYear.set(y, cur)
  }

  return {
    total: unique.length,
    amount,
    awards: unique,
    byYear: [...byYear.values()].sort((a, b) => b.year - a.year),
    truncated,
  }
}

/**
 * 상태 점검용 1건 호출. 낙찰자 필터 없이 어제 하루만 본다 — 키와 경로가 살아 있는지만 확인한다.
 * 경로 후보를 두 개 두었으므로 핸들러와 같은 코드로 불러야 한다(URL 을 또 적으면 어긋난다).
 */
export async function probeG2b(key, now = new Date()) {
  if (!key) return { ok: false, detail: '키가 설정되지 않았습니다 (G2B_API_KEY 또는 NPS_API_KEY)', optional: true }
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const w = { from: stamp(yesterday, false), to: stamp(yesterday, true) }
  const state = { calls: 0, base: 0 }
  const { error } = await call({ kind: 'name', value: '' }, w, 1, key, state)
  if (error) return { ok: false, detail: error, optional: true }
  return { ok: true, detail: '정상' }
}
