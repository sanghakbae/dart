// DART 프록시의 실제 알맹이. 개발 서버(Vite 미들웨어)와 Cloudflare Worker 가 함께 쓴다.
//
// OpenDART 는 두 가지 이유로 브라우저에서 직접 못 부른다.
//   1. CORS 헤더를 주지 않는다
//   2. 인증키가 번들에 박히면 그대로 노출된다
// 그래서 키는 이쪽에만 두고, 아래 세 경로만 열어 준다.
//
//   GET /api/dart/filings?corp=00126380[&from=20200101][&to=20261231]
//   GET /api/dart/company?corp=00126380
//   GET /api/dart/document?rcept=20260402003876      → 공시원문 XML (ZIP 해제 후)
//
// 표준 Request → Response 만 쓰므로 런타임에 의존하지 않는다.

const DART = 'https://opendart.fss.or.kr/api'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** 공시 종류: 감사보고서류만 남긴다(A = 정기공시, F = 외부감사관련). */
const AUDIT_RE = /(감사보고서|검토보고서|사업보고서|반기보고서|분기보고서)/

export function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

/**
 * 상류(opendart) 호출.
 *
 * Cloudflare Worker 에서 부르면 "Too many redirects" 로 실패한다 — 개발 서버(Node)나
 * 사무실 IP 에서는 200 이 그냥 온다. opendart 가 데이터센터 IP·빈 User-Agent 를
 * 걸러 리다이렉트로 되돌리는 것으로 보인다. 그래서
 *   1) 브라우저 같은 헤더를 붙이고
 *   2) 리다이렉트를 직접 따라가며 쿠키를 이어 준다(쿠키 한 번 받고 통과하는 형태 대응).
 * 그래도 반복되면 인증키가 들어간 URL 을 노출하지 않는 메시지로 끊는다.
 */
const UPSTREAM_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  accept: 'application/json,text/plain,application/zip,*/*',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

async function fetchUpstream(target) {
  let url = String(target)
  let cookie = ''
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { ...UPSTREAM_HEADERS, ...(cookie ? { cookie } : {}) },
    })
    if (res.status < 300 || res.status >= 400) return res
    const loc = res.headers.get('location')
    if (!loc) return res
    const set = res.headers.get('set-cookie')
    if (set) cookie = [cookie, set.split(';')[0]].filter(Boolean).join('; ')
    url = new URL(loc, url).toString()
  }
  throw new Error(`DART 가 리다이렉트를 반복합니다 (${new URL(url).pathname}). 상류에서 요청을 차단한 것으로 보입니다.`)
}

/**
 * ZIP(단일 엔트리)에서 첫 파일을 꺼낸다. DART document.xml 응답은 XML 하나만 들어 있다.
 * DecompressionStream 은 Worker·Node18+·최신 브라우저 모두 지원한다.
 */
async function unzipFirst(buf) {
  const view = new DataView(buf)
  if (view.getUint32(0, true) !== 0x04034b50) {
    // 인증 실패 등은 ZIP 이 아니라 XML 에러로 온다.
    const text = new TextDecoder('utf-8').decode(buf)
    throw new Error(`DART 응답이 ZIP 이 아닙니다: ${text.slice(0, 200)}`)
  }
  const method = view.getUint16(8, true)
  const nameLen = view.getUint16(26, true)
  const extraLen = view.getUint16(28, true)
  const start = 30 + nameLen + extraLen
  let size = view.getUint32(18, true)
  if (!size) size = buf.byteLength - start
  const body = buf.slice(start, start + size)
  if (method === 0) return body
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([body]).stream().pipeThrough(ds)
  return await new Response(stream).arrayBuffer()
}

/**
 * DART 원문 디코딩.
 *
 * XML 선언의 encoding 을 믿으면 안 된다 — 실제로는 UTF-8 인데 euc-kr 로 선언된
 * 옛 문서가 있고, 그대로 따르면 한글이 전부 "占쏙옙" 로 깨진다(숫자만 멀쩡해서
 * 눈에 잘 안 띈다). 바이트를 직접 보고 판별한다.
 *
 * EUC-KR 바이트열은 UTF-8 로 엄격 디코딩하면 거의 반드시 실패하므로,
 * UTF-8 을 fatal 로 먼저 시도하고 실패할 때만 EUC-KR 로 넘어간다.
 */
function decodeDart(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }
}

async function dartJson(path, params, key) {
  const url = new URL(`${DART}/${path}`)
  url.searchParams.set('crtfc_key', key)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v)
  const res = await fetchUpstream(url)
  if (!res.ok) throw new Error(`DART HTTP ${res.status}`)
  return res.json()
}

/**
 * @param {Request} req
 * @param {string} key  OpenDART 인증키
 * @returns {Promise<Response|null>}  /api/dart/* 가 아니면 null
 */
export async function handleDart(req, key) {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/dart/')) return null

  const cors = corsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!key) return json({ error: 'DART_API_KEY 가 서버에 설정되지 않았습니다.' }, 500, cors)

  const op = url.pathname.slice('/api/dart/'.length)
  const q = url.searchParams

  try {
    if (op === 'company') {
      const corp = q.get('corp')
      if (!corp) return json({ error: 'corp 파라미터가 필요합니다.' }, 400, cors)
      const d = await dartJson('company.json', { corp_code: corp }, key)
      if (d.status !== '000') return json({ error: `${d.status} ${d.message}` }, 502, cors)
      return json(d, 200, cors)
    }

    if (op === 'filings') {
      const corp = q.get('corp')
      if (!corp) return json({ error: 'corp 파라미터가 필요합니다.' }, 400, cors)
      const d = await dartJson(
        'list.json',
        {
          corp_code: corp,
          bgn_de: q.get('from') || '20150101',
          end_de: q.get('to') || ymd(new Date()),
          page_count: '100',
        },
        key
      )
      // 013 = 조회된 데이터 없음. 오류가 아니라 '공시 없음'으로 다룬다.
      if (d.status === '013') return json({ total: 0, list: [] }, 200, cors)
      if (d.status !== '000') return json({ error: `${d.status} ${d.message}` }, 502, cors)
      const list = (d.list || [])
        .filter((r) => AUDIT_RE.test(r.report_nm || ''))
        .map((r) => ({
          rceptNo: r.rcept_no,
          reportNm: (r.report_nm || '').trim(),
          rceptDt: r.rcept_dt,
          flrNm: r.flr_nm,
          corpName: r.corp_name,
        }))
      return json({ total: list.length, list }, 200, cors)
    }

    if (op === 'document') {
      const rcept = q.get('rcept')
      if (!/^\d{14}$/.test(rcept || '')) return json({ error: 'rcept(접수번호 14자리)가 필요합니다.' }, 400, cors)
      const durl = new URL(`${DART}/document.xml`)
      durl.searchParams.set('crtfc_key', key)
      durl.searchParams.set('rcept_no', rcept)
      const res = await fetchUpstream(durl)
      if (!res.ok) throw new Error(`DART HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const xml = decodeDart(await unzipFirst(buf))
      return new Response(xml, {
        status: 200,
        headers: { 'content-type': 'text/xml; charset=utf-8', ...cors },
      })
    }

    return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
