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

// 국민연금은 평소에도 10초 안팎이 걸린다. 짧게 잡으면 멀쩡한 API 가 죽은 것으로 보인다.
const TIMEOUT = 15_000

const json = (body, status, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra },
  })

async function timed(fn) {
  const started = Date.now()
  try {
    const r = await fn()
    return { ...r, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, detail: String(e?.message || e), ms: Date.now() - started }
  }
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
  const res = await withTimeout(url)
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
 * @param {{DART_API_KEY?:string, NPS_API_KEY?:string, KIPRIS_API_KEY?:string}} keys
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

  const [dart, nps, kipris] = await Promise.all([
    timed(() => checkDart(keys.DART_API_KEY)),
    timed(() => checkNps(keys.NPS_API_KEY)),
    timed(() => checkKipris(keys.KIPRIS_API_KEY)),
  ])

  // short 는 좁은 화면용 축약 라벨이다(헤더를 한 줄에 담아야 한다).
  const services = [
    { id: 'dart', label: 'DART', short: 'DART', ...dart },
    { id: 'nps', label: '국민연금', short: '연금', ...nps },
    { id: 'kipris', label: 'KIPRIS', short: '특허', ...kipris },
  ]
  // 선택 서비스(KIPRIS)는 없더라도 전체를 실패로 보지 않는다.
  const ok = services.filter((s) => !s.optional).every((s) => s.ok)
  return json({ ok, checkedAt: Date.now(), services }, 200, cors)
}
