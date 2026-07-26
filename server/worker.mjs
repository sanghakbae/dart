// Cloudflare Worker — 배포본의 DART·국민연금 프록시.
//
// GitHub Pages 는 정적 호스팅이라 /api/* 를 처리할 수 없다. 그래서 같은 핸들러를
// Worker 에 올려 배포본에서도 조회가 되게 한다(개발 서버는 vite-dart-plugin 이 같은 핸들러를 쓴다).
//
// 인증키는 Worker 시크릿에만 둔다:
//   wrangler secret put DART_API_KEY
//   wrangler secret put NPS_API_KEY
//
// 공개 URL 이므로 허용 오리진을 제한한다. 열어두면 아무 사이트나 이 프록시로
// 우리 인증키 할당량을 소모할 수 있다.

import { handleDart } from './dart-handler.mjs'
import { handleNps } from './nps-handler.mjs'

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

    if (url.pathname === '/health') {
      return json(
        { ok: true, dart: Boolean(env.DART_API_KEY), nps: Boolean(env.NPS_API_KEY) },
        200,
        allowed ? { 'access-control-allow-origin': allowed } : {}
      )
    }

    const isDart = url.pathname.startsWith('/api/dart/')
    const isNps = url.pathname.startsWith('/api/nps/')
    if (!isDart && !isNps) return json({ error: `알 수 없는 경로: ${url.pathname}` }, 404, {})

    // 브라우저에서 온 요청인데 허용 목록에 없으면 여기서 끊는다.
    // (서버 대 서버 호출은 Origin 헤더가 없어 통과시킨다)
    if (origin && !allowed) {
      return json({ error: `허용되지 않은 오리진입니다: ${origin}` }, 403, {})
    }

    // 핸들러는 요청 Origin 을 그대로 반영하므로, 검증을 통과한 값만 넘긴다.
    const forwarded = new Request(request.url, {
      method: request.method,
      headers: stripOrigin(request.headers, allowed),
    })

    const response = isNps
      ? await handleNps(forwarded, env.NPS_API_KEY || '')
      : await handleDart(forwarded, env.DART_API_KEY || '')

    return response || json({ error: '처리할 수 없는 요청입니다.' }, 404, {})
  },
}

/** 검증에 실패한 Origin 은 지워서 핸들러가 '*' 로 응답하지 않게 한다 */
function stripOrigin(headers, allowed) {
  const out = new Headers(headers)
  if (allowed) out.set('origin', allowed)
  else out.delete('origin')
  return out
}
