// 외부 API 상태 점검.
//
//   GET /api/health
//
// Worker 의 /health 와 다르다 — 그쪽은 Worker 가 살아 있는지만 보는 용도라
// 상류를 부르지 않는다. 여기는 실제로 불러 본다.
//
// 키가 설정돼 있는지만 보지 않는다 — 키가 있어도 만료·미승인·표기법 변경으로
// 조용히 실패하는 일이 잦았다(국민연금은 옛 스네이크 표기로 부르면 오류 없이 0건,
// KIPRIS 는 사용기간이 끝나도 200 으로 응답한다). 그래서 실제로 한 번 불러 본다.
//
// 화면 상단에 그대로 띄우기 때문에 응답은 작고 빠르게 유지한다.

import { fetchUpstream } from './dart-handler.mjs'
// 국세청·조달청은 URL 과 경로 후보를 핸들러가 갖고 있다. 여기서 다시 적으면
// 한쪽만 고쳐 놓고 '정상' 을 띄우게 되므로 핸들러의 점검 함수를 그대로 부른다.
import { probeNts } from './nts-handler.mjs'
import { probeG2b } from './g2b-handler.mjs'

// 국민연금은 평소에도 10초 안팎이 걸린다. 짧게 잡으면 멀쩡한 API 가 죽은 것으로 보인다.
const TIMEOUT = 25_000

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  })

async function timed(fn, keys) {
  const started = Date.now()
  try {
    const r = await fn()
    return { ...r, detail: redact(r.detail, keys), ms: Date.now() - started }
  } catch (e) {
    // 시간 초과는 죽은 것과 다르다. 국민연금은 10초 안팎이 예사라 몰릴 때 걸리는데,
    // 그걸 빨간 칩으로 띄우면 멀쩡한 API 를 장애로 읽게 된다.
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    if (timedOut) {
      return { ok: false, slow: true, detail: `응답이 ${TIMEOUT / 1000}초 안에 오지 않았습니다`, ms: Date.now() - started }
    }
    return { ok: false, detail: redact(String(e?.message || e), keys), ms: Date.now() - started }
  }
}

/**
 * 응답에서 인증키와 상류 URL 을 지운다.
 *
 * 상태는 200 으로 나가기 때문에 Worker 의 scrub(4xx 만 처리)이 걸리지 않는다.
 * 실제로 Cloudflare 의 "Too many redirects. <url>, <url> …" 메시지가 인증키가 박힌
 * URL 을 그대로 담아 /api/health 로 새어 나갔다. 여기서 반드시 막아야 한다.
 */
function redact(text, keys = []) {
  let out = String(text ?? '')
  for (const k of keys) if (k && k.length >= 8) out = out.split(k).join('<KEY>')
  // 키를 지운 뒤에도 남는 URL 은 쿼리스트링을 통째로 잘라 낸다.
  out = out.replace(/https?:\/\/[^\s,)]+/g, (m) => {
    try {
      const u = new URL(m)
      return u.origin + u.pathname
    } catch {
      return '<URL>'
    }
  })
  return out.length > 300 ? `${out.slice(0, 300)}…` : out
}

function withTimeout(url, init) {
  // AbortSignal.timeout 은 Worker·Node18+ 모두 있다.
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) })
}

/** DART — 존재하는 회사의 공시 목록을 1건만 부른다. 013(없음)도 정상 응답이다. */
async function checkDart(key) {
  if (!key) return { ok: false, detail: '키가 설정되지 않았습니다 (DART_API_KEY)' }
  const url = new URL('https://opendart.fss.or.kr/api/list.json')
  url.searchParams.set('crtfc_key', key)
  url.searchParams.set('corp_code', '01826274') // 무하유
  url.searchParams.set('bgn_de', '20260101')
  url.searchParams.set('end_de', '20261231')
  url.searchParams.set('page_count', '1')
  // 개발 서버의 fetch 로는 되지만 Worker 에서는 리다이렉트로 막힌다.
  // dart-handler 와 같은 상류 호출기를 써야 한다.
  const res = await fetchUpstream(url)
  const d = await res.json().catch(() => ({}))
  if (d.status === '000' || d.status === '013') return { ok: true, detail: '정상' }
  return { ok: false, detail: `${d.status || res.status} ${d.message || ''}`.trim() }
}

/** 국민연금 — 사업장 1건 조회. 카멜 표기를 쓴다(2025-05 이후 스네이크는 0건만 돌아온다). */
async function checkNps(key) {
  if (!key) return { ok: false, detail: '키가 설정되지 않았습니다 (NPS_API_KEY)' }
  const url = new URL('https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2/getBassInfoSearchV2')
  url.searchParams.set('serviceKey', key)
  url.searchParams.set('dataType', 'json')
  url.searchParams.set('wkplNm', '무하유')
  url.searchParams.set('numOfRows', '1')
  url.searchParams.set('pageNo', '1')
  const res = await withTimeout(url)
  const text = await res.text()
  if (text.trim() === 'Unauthorized') return { ok: false, detail: '인증키가 게이트웨이에 등록되지 않았습니다' }
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return { ok: false, detail: `응답을 해석할 수 없습니다 (${res.status})` }
  }
  const h = d?.response?.header
  if (h?.resultCode === '00') return { ok: true, detail: '정상' }
  return { ok: false, detail: `${h?.resultCode || res.status} ${h?.resultMsg || ''}`.trim() }
}

/**
 * KIPRIS Plus — 출원인 검색 1건.
 * 인증 파라미터는 accessKey 다. ServiceKey 로 보내면 등록되지 않은 키로 취급한다.
 */
async function checkKipris(key) {
  if (!key) return { ok: false, detail: '키가 설정되지 않았습니다 (KIPRIS_API_KEY)', optional: true }
  const url = new URL('http://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice/applicantNameSearchInfo')
  url.searchParams.set('applicant', '무하유')
  url.searchParams.set('accessKey', key)
  url.searchParams.set('numOfRows', '1')
  const res = await withTimeout(url)
  const text = await res.text()
  const code = /<resultCode>(\d+)/.exec(text)?.[1]
  const msg = /<resultMsg>([^<]*)/.exec(text)?.[1] || ''
  if (!code || code === '00') return { ok: true, detail: '정상' }
  if (code === '31') return { ok: false, detail: '사용기간이 만료됐거나 아직 시작되지 않았습니다 (31)' }
  if (code === '30') return { ok: false, detail: '이 서비스에 등록되지 않은 키입니다 (30)' }
  return { ok: false, detail: `${code} ${msg}`.trim() }
}

/**
 * @param {Request} req
 * @param {{DART_API_KEY?:string, NPS_API_KEY?:string, KIPRIS_API_KEY?:string, NTS_API_KEY?:string, G2B_API_KEY?:string}} keys
 * @returns {Promise<Response|null>}
 */
export async function handleHealth(req, keys = {}) {
  const url = new URL(req.url)
  if (url.pathname !== '/api/health') return null

  const cors = {
    'access-control-allow-origin': req.headers.get('origin') || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    // 상태는 잠깐 캐시해도 된다 — 화면을 열 때마다 상류를 세 번씩 두드릴 이유가 없다.
    'cache-control': 'public, max-age=60',
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  // 국세청·조달청은 국민연금과 같은 공공데이터포털이다. 전용 키가 없으면 그 키를 쓴다.
  const ntsKey = keys.NTS_API_KEY || keys.NPS_API_KEY
  const g2bKey = keys.G2B_API_KEY || keys.NPS_API_KEY
  const secrets = [keys.DART_API_KEY, keys.NPS_API_KEY, keys.KIPRIS_API_KEY, ntsKey, g2bKey].filter(Boolean)
  const [dart, nps, kipris, nts, g2b] = await Promise.all([
    timed(() => checkDart(keys.DART_API_KEY), secrets),
    timed(() => checkNps(keys.NPS_API_KEY), secrets),
    timed(() => checkKipris(keys.KIPRIS_API_KEY), secrets),
    timed(() => probeNts(ntsKey), secrets),
    timed(() => probeG2b(g2bKey), secrets),
  ])

  // short 는 좁은 화면용 축약 라벨이다(헤더를 한 줄에 담아야 한다).
  const services = [
    { id: 'dart', label: 'DART', short: 'DART', ...dart },
    { id: 'nps', label: '국민연금', short: '연금', ...nps },
    { id: 'kipris', label: 'KIPRIS', short: '특허', ...kipris },
    { id: 'nts', label: '국세청', short: '국세', ...nts },
    { id: 'g2b', label: '나라장터', short: '조달', ...g2b },
  ]
  // 선택 서비스(KIPRIS·국세청·나라장터)는 없더라도, 느려서 못 본 것도 전체 실패로 보지 않는다.
  const ok = services.filter((s) => !s.optional).every((s) => s.ok || s.slow)
  return json({ ok, checkedAt: Date.now(), services }, 200, cors)
}
