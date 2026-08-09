// 국민연금 프록시 (Firebase Cloud Functions).
//
// 왜 Cloudflare 가 아니라 여기인가
//   data.go.kr 은 Cloudflare Worker 에서 오는 요청을 즉시 거절한다 —
//   같은 Worker 에서 opendart 는 200(0.5초)인데 apis.data.go.kr 은 8회 연속 실패했고,
//   브라우저 헤더·재시도·Smart Placement 어느 것도 통하지 않았다.
//   같은 호출이 일반 회선에서는 6.5초 걸려 정상 응답한다. 출구 IP 문제라 코드로는
//   풀 수 없어, 구글 IP 로 나가는 이 함수를 국민연금 전용 출구로 둔다.
//
//   DART·KIPRIS 는 Cloudflare 에서 잘 되므로 그대로 둔다. 여기로 다 몰지 않는다.
//
// 인증키는 시크릿으로만 둔다:
//   firebase functions:secrets:set NPS_API_KEY
//
// 핸들러(server/*.mjs)는 Cloudflare Worker 와 같은 파일을 쓴다. 배포 직전에
// scripts/sync-functions.mjs 가 이 폴더로 복사하므로 동작이 갈리지 않는다.

import { onRequest } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { handleNps } from './server/nps-handler.mjs'
import { handleNts } from './server/nts-handler.mjs'
import { apiPathOf, apiUrlOf } from './server/api-path.mjs'

const NPS_API_KEY = defineSecret('NPS_API_KEY')
const NTS_API_KEY = defineSecret('NTS_API_KEY')

// 공개 URL 이므로 오리진을 제한한다. 열어 두면 아무 사이트나 우리 할당량을 태운다.
const ALLOWED = [
  'https://dart.sanghak.kr',
  'http://localhost:5182',
  'http://127.0.0.1:5182',
]

function allowOrigin(origin) {
  if (!origin) return null
  return ALLOWED.includes(origin) ? origin : null
}

/** Node 요청 → 표준 Request. 핸들러가 런타임에 의존하지 않게 맞춰 준다. */
function toRequest(req) {
  const url = `https://${req.headers.host || 'localhost'}${apiUrlOf(req)}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue
    headers.set(k, Array.isArray(v) ? v.join(', ') : String(v))
  }
  return new Request(url, { method: req.method, headers })
}

async function send(res, response) {
  res.status(response.status)
  response.headers.forEach((v, k) => res.setHeader(k, v))
  res.send(Buffer.from(await response.arrayBuffer()))
}

const json = (res, body, status, headers = {}) => {
  res.status(status)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.send(JSON.stringify(body))
}

export const api = onRequest(
  {
    region: 'asia-northeast3', // 서울 — 상류가 국내라 왕복이 짧다
    secrets: [NPS_API_KEY, NTS_API_KEY],
    // 국민연금은 평소에도 6~7초가 걸린다. 짧게 잡으면 멀쩡한 조회가 끊긴다.
    timeoutSeconds: 120,
    memory: '256MiB',
    cors: false, // 오리진 검사는 아래에서 직접 한다
  },
  async (req, res) => {
    const origin = req.headers.origin || null
    const allowed = allowOrigin(origin)

    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.setHeader('access-control-allow-origin', allowed)
        res.setHeader('access-control-allow-methods', 'GET,OPTIONS')
        res.setHeader('access-control-max-age', '86400')
      }
      return res.status(204).send('')
    }

    const path = apiPathOf(req.originalUrl || req.url)
    if (path === '/health' || path === '/api/health') {
      return json(
        res,
        { ok: true, nps: Boolean(NPS_API_KEY.value()), nts: Boolean(NTS_API_KEY.value()) },
        200,
        allowed ? { 'access-control-allow-origin': allowed } : {}
      )
    }

    const isNps = path.startsWith('/api/nps/')
    const isNts = path.startsWith('/api/nts/')
    if (!isNps && !isNts) return json(res, { error: `알 수 없는 경로: ${path}` }, 404)

    // 브라우저에서 온 요청인데 허용 목록에 없으면 여기서 끊는다.
    // (서버 대 서버 호출은 Origin 헤더가 없어 통과시킨다)
    if (origin && !allowed) {
      return json(res, { error: `허용되지 않은 오리진입니다: ${origin}` }, 403)
    }

    const request = toRequest(req)
    try {
      const response = isNps
        ? await handleNps(request, NPS_API_KEY.value() || '')
        : await handleNts(request, NTS_API_KEY.value() || '')
      if (!response) return json(res, { error: '처리할 수 없는 요청입니다.' }, 404)
      return send(res, response)
    } catch (e) {
      return json(res, { error: String(e?.message || e) }, 502)
    }
  }
)
