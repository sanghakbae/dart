// Cloudflare Worker — 배포본의 DART·국민연금 프록시.
//
// GitHub Pages 는 정적 호스팅이라 /api/* 를 처리할 수 없다. 그래서 같은 핸들러를
// Worker 에 올려 배포본에서도 조회가 되게 한다(개발 서버는 vite-dart-plugin 이 같은 핸들러를 쓴다).
//
// 인증키는 Worker 시크릿에만 둔다:
//   wrangler secret put DART_API_KEY
//   wrangler secret put NPS_API_KEY
//   wrangler secret put KIPRIS_API_KEY
//
// 공개 URL 이므로 허용 오리진을 제한한다. 열어두면 아무 사이트나 이 프록시로
// 우리 인증키 할당량을 소모할 수 있다.

import { handleDart } from './dart-handler.mjs'
import { handleNps } from './nps-handler.mjs'
import { handleKipris } from './kipris-handler.mjs'
import { handleNts } from './nts-handler.mjs'
import { handleHealth } from './health-handler.mjs'

const ALLOWED = [
  'https://dart.sanghak.kr',
  'http://localhost:5182',
  'http://127.0.0.1:5182',
]

/** 허용 오리진이면 그 값을, 아니면 null (그 경우 CORS 헤더를 주지 않는다) */
function allowOrigin(origin, extra) {
  if (!origin) return null
  const list = extra ? [...ALLOWED, ...extra.split(',').map((s) => s.trim()).filter(Boolean)] : ALLOWED
  return list.includes(origin) ? origin : null
}

const json = (body, status, headers) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const origin = request.headers.get('origin')
    const allowed = allowOrigin(origin, env.ALLOWED_ORIGINS)

    // /health 는 Worker 자체가 살아 있는지 보는 용도다. 상류를 부르지 않는다.
    if (url.pathname === '/health') {
      return json(
        { ok: true, dart: Boolean(env.DART_API_KEY), nps: Boolean(env.NPS_API_KEY) },
        200,
        allowed ? { 'access-control-allow-origin': allowed } : {}
      )
    }

    const isHealth = url.pathname === '/api/health'
    const isDart = url.pathname.startsWith('/api/dart/')
    const isNps = url.pathname.startsWith('/api/nps/')
    const isKipris = url.pathname.startsWith('/api/kipris/')
    const isNts = url.pathname.startsWith('/api/nts/')
    if (!isHealth && !isDart && !isNps && !isKipris && !isNts) {
      return json({ error: `알 수 없는 경로: ${url.pathname}` }, 404, {})
    }

    // 브라우저에서 온 요청인데 허용 목록에 없으면 여기서 끊는다.
    // (서버 대 서버 호출은 Origin 헤더가 없어 통과시킨다)
    //
    // /api/health 도 예외가 아니다 — 상류를 세 번 부르는 경로라, 열어 두면
    // 남의 사이트가 우리 인증키 할당량을 태울 수 있다.
    if (origin && !allowed) {
      return json({ error: `허용되지 않은 오리진입니다: ${origin}` }, 403, {})
    }

    // 핸들러는 요청 Origin 을 그대로 반영하므로, 검증을 통과한 값만 넘긴다.
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: stripOrigin(request.headers, allowed),
    })

    // /api/health 는 상류를 실제로 한 번씩 불러 본 결과를 준다(화면 상단 상태 칩).
    if (isHealth) return handleHealth(forwarded, env)

    const response = isNps
      ? await handleNps(forwarded, env.NPS_API_KEY || '')
      : isKipris
        ? await handleKipris(forwarded, env.KIPRIS_API_KEY || '')
        : isNts
          ? await handleNts(forwarded, env.NTS_API_KEY || '')
          : await handleDart(forwarded, env.DART_API_KEY || '')

    if (!response) return json({ error: '처리할 수 없는 요청입니다.' }, 404, {})
    return scrub(response, env)
  },
}

/**
 * 오류 응답에서 인증키를 지운다.
 *
 * 상류 요청 URL 에 crtfc_key·serviceKey 가 들어가는데, Cloudflare 의 fetch 실패 메시지
 * ("Too many redirects. <url>, <url>")는 그 URL 을 그대로 담는다. 그걸 그대로 내보내면
 * 브라우저에 인증키가 노출된다. 성공 응답은 본문이 클 수 있어 건드리지 않는다.
 */
async function scrub(response, env) {
  if (response.status < 400) return response
  const keys = [env.DART_API_KEY, env.NPS_API_KEY, env.KIPRIS_API_KEY, env.NTS_API_KEY].filter((k) => k && k.length >= 8)
  if (!keys.length) return response

  // 본문을 읽는 순간 원본 Response 는 다시 쓸 수 없다. 지울 게 없더라도
  // 원본을 그대로 돌려주면 안 된다 — 읽힌 본문으로 나가 오류 메시지가 통째로 사라진다.
  const text = await response.text()
  let out = text
  for (const k of keys) out = out.split(k).join('<KEY>')
  // 키를 지운 뒤에도 상류 URL 이 남으면 통째로 줄인다.
  // 정규식에 걸렸다고 다 URL 은 아니다 — 여기서 던지면 오류 응답 자체가 사라진다.
  out = out.replace(/https?:\/\/[^\s",]+/g, (m) => {
    try {
      const u = new URL(m)
      return u.origin + u.pathname
    } catch {
      return '<URL>'
    }
  })

  // 본문 길이가 달라졌으므로 원본 헤더의 content-length·content-encoding 을 물려주면
  // 응답이 잘리거나 디코딩에 실패한다. 런타임이 다시 계산하도록 지운다.
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('content-encoding')
  return new Response(out, { status: response.status, headers })
}

/** 검증에 실패한 Origin 은 지워서 핸들러가 '*' 로 응답하지 않게 한다 */
function stripOrigin(headers, allowed) {
  const out = new Headers(headers)
  if (allowed) out.set('origin', allowed)
  else out.delete('origin')
  return out
}
