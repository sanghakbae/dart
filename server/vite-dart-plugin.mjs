// 개발 서버용 DART 프록시.
// 배포本(Cloudflare Worker)과 같은 핸들러를 쓰므로 동작이 갈리지 않는다.
// 인증키는 .env 의 DART_API_KEY 에서 읽고 브라우저로 내려보내지 않는다.
// (VITE_ 접두사를 쓰지 않는 이유 — 그걸 붙이면 번들에 박힌다)

import { handleDart } from './dart-handler.mjs'

export function dartProxy(env = {}) {
  const key = env.DART_API_KEY || process.env.DART_API_KEY || ''

  return {
    name: 'dart-proxy',
    configureServer(server) {
      if (!key) {
        server.config.logger.warn(
          '[dart-proxy] DART_API_KEY 가 없습니다. .env 에 넣어야 DART 가져오기가 동작합니다.'
        )
      }
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/dart/')) return next()
        try {
          const url = `http://localhost${req.url}`
          const request = new Request(url, { method: req.method, headers: toHeaders(req.headers) })
          const response = await handleDart(request, key)
          if (!response) return next()
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: String(e?.message || e) }))
        }
      })
    },
  }
}

function toHeaders(nodeHeaders) {
  const h = new Headers()
  for (const [k, v] of Object.entries(nodeHeaders)) {
    if (v == null) continue
    h.set(k, Array.isArray(v) ? v.join(', ') : String(v))
  }
  return h
}
