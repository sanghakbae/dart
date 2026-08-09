// 개발 서버용 DART 프록시.
// 배포本(Cloudflare Worker)과 같은 핸들러를 쓰므로 동작이 갈리지 않는다.
// 인증키는 .env 의 DART_API_KEY 에서 읽고 브라우저로 내려보내지 않는다.
// (VITE_ 접두사를 쓰지 않는 이유 — 그걸 붙이면 번들에 박힌다)

import { handleDart } from './dart-handler.mjs'
import { handleNps } from './nps-handler.mjs'
import { handleKipris } from './kipris-handler.mjs'
import { handleHealth } from './health-handler.mjs'
import { resolveKeys } from './api-keys.mjs'

export function dartProxy(env = {}) {
  // 개발 서버도 배포본과 같은 규칙을 따른다 — DB(관리자 페이지)에 등록된 키가
  // 있으면 그걸 쓰고, 없으면 .env 값을 쓴다.
  const source = {
    DART_API_KEY: env.DART_API_KEY || process.env.DART_API_KEY || '',
    NPS_API_KEY: env.NPS_API_KEY || process.env.NPS_API_KEY || '',
    KIPRIS_API_KEY: env.KIPRIS_API_KEY || process.env.KIPRIS_API_KEY || '',
    FIREBASE_SERVICE_ACCOUNT:
      env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT || '',
  }
  const dartKey = source.DART_API_KEY
  const npsKey = source.NPS_API_KEY

  return {
    name: 'dart-proxy',
    configureServer(server) {
      if (!dartKey) {
        server.config.logger.warn(
          '[dart-proxy] DART_API_KEY 가 없습니다. .env 에 넣어야 DART 가져오기가 동작합니다.'
        )
      }
      if (!npsKey) {
        server.config.logger.warn(
          '[dart-proxy] NPS_API_KEY 가 없습니다. .env 에 넣어야 고용 정보가 동작합니다.'
        )
      }
      server.middlewares.use(async (req, res, next) => {
        const isHealth = req.url === '/api/health' || req.url?.startsWith('/api/health?')
        const isApi = ['/api/dart/', '/api/nps/', '/api/kipris/'].some((p) => req.url?.startsWith(p))
        if (!isHealth && !isApi) return next()
        try {
          const url = `http://localhost${req.url}`
          const request = new Request(url, { method: req.method, headers: toHeaders(req.headers) })
          const keys = await resolveKeys(source)
          const response = isHealth
            ? await handleHealth(request, keys)
            : req.url.startsWith('/api/nps/')
              ? await handleNps(request, keys.NPS_API_KEY)
              : req.url.startsWith('/api/kipris/')
                ? await handleKipris(request, keys.KIPRIS_API_KEY)
                : await handleDart(request, keys.DART_API_KEY)
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
