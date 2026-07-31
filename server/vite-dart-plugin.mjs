// 개발 서버용 DART 프록시.
// 배포本(Cloudflare Worker)과 같은 핸들러를 쓰므로 동작이 갈리지 않는다.
// 인증키는 .env 의 DART_API_KEY 에서 읽고 브라우저로 내려보내지 않는다.
// (VITE_ 접두사를 쓰지 않는 이유 — 그걸 붙이면 번들에 박힌다)

import { handleDart } from './dart-handler.mjs'
import { handleNps } from './nps-handler.mjs'
import { handleKipris } from './kipris-handler.mjs'
import { handleNts } from './nts-handler.mjs'
import { handleG2b } from './g2b-handler.mjs'
import { handleHealth } from './health-handler.mjs'

export function dartProxy(env = {}) {
  const dartKey = env.DART_API_KEY || process.env.DART_API_KEY || ''
  const npsKey = env.NPS_API_KEY || process.env.NPS_API_KEY || ''
  const kiprisKey = env.KIPRIS_API_KEY || process.env.KIPRIS_API_KEY || ''
  // 국세청·조달청은 국민연금과 같은 공공데이터포털이다. 포털 인증키는 계정당 하나이므로
  // 전용 키가 없으면 NPS_API_KEY 를 그대로 쓴다(두 서비스를 활용신청해 두었다면 그대로 된다).
  const ntsKey = env.NTS_API_KEY || process.env.NTS_API_KEY || npsKey
  const g2bKey = env.G2B_API_KEY || process.env.G2B_API_KEY || npsKey

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
        const isApi = ['/api/dart/', '/api/nps/', '/api/kipris/', '/api/nts/', '/api/g2b/'].some((p) =>
          req.url?.startsWith(p)
        )
        if (!isHealth && !isApi) return next()
        try {
          const url = `http://localhost${req.url}`
          const request = new Request(url, { method: req.method, headers: toHeaders(req.headers) })
          const response = isHealth
            ? await handleHealth(request, {
                DART_API_KEY: dartKey,
                NPS_API_KEY: npsKey,
                KIPRIS_API_KEY: kiprisKey,
                NTS_API_KEY: ntsKey,
                G2B_API_KEY: g2bKey,
              })
            : req.url.startsWith('/api/nps/')
              ? await handleNps(request, npsKey)
              : req.url.startsWith('/api/kipris/')
                ? await handleKipris(request, kiprisKey)
                : req.url.startsWith('/api/nts/')
                  ? await handleNts(request, ntsKey)
                  : req.url.startsWith('/api/g2b/')
                    ? await handleG2b(request, g2bKey)
                    : await handleDart(request, dartKey)
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
