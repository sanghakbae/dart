// Worker 라우팅·CORS 검증. 외부 API 는 호출하지 않고 키 검사 단계까지만 본다.
// 프록시를 공개 URL 로 두는 만큼, 오리진 제한이 실제로 걸리는지가 중요하다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const w = (await import(join(here, '../server/worker.mjs'))).default

const t = (name, fn) => test(name, fn)
const eq = (a, b, m) => assert.deepEqual(a, b, m)
const req = (path, origin) => new Request(`https://dart-proxy.example.workers.dev${path}`, origin ? { headers: { origin } } : undefined)

test('health — 키 설정 여부를 알려준다', async () => {
  const r = await w.fetch(req('/health'), {})
  eq(r.status, 200)
  // fromDb 는 인증키를 DB 에서 읽고 있는지. 서비스 계정이 없으면 false 다.
  eq(await r.json(), { ok: true, dart: false, nps: false, kipris: false, fromDb: false })
})
test('health — 키가 있으면 true', async () => {
  const r = await w.fetch(req('/health'), { DART_API_KEY: 'x', NPS_API_KEY: 'y' })
  eq(await r.json(), { ok: true, dart: true, nps: true, kipris: false, fromDb: false })
})
test('모르는 경로는 404', async () => {
  eq((await w.fetch(req('/nope'), {})).status, 404)
})

test('허용 오리진(dart.sanghak.kr)은 통과', async () => {
  const r = await w.fetch(req('/api/nps/timeline?name=x', 'https://dart.sanghak.kr'), {})
  eq(r.status, 500) // 키가 없어 500 (오리진 차단 403 이 아님)
  eq(r.headers.get('access-control-allow-origin'), 'https://dart.sanghak.kr')
})
test('개발 서버 오리진도 통과', async () => {
  const r = await w.fetch(req('/api/dart/company?corp=1', 'http://localhost:5182'), {})
  eq(r.status, 500)
})
test('허용되지 않은 오리진은 403 + CORS 헤더 없음', async () => {
  const r = await w.fetch(req('/api/nps/timeline?name=x', 'https://evil.example.com'), { NPS_API_KEY: 'k' })
  eq(r.status, 403)
  eq(r.headers.get('access-control-allow-origin'), null)
})
test('ALLOWED_ORIGINS 로 추가 허용', async () => {
  const r = await w.fetch(req('/api/nps/timeline?name=x', 'https://preview.example.com'), { ALLOWED_ORIGINS: 'https://preview.example.com' })
  eq(r.status, 500) // 통과해서 키 검사까지 갔다
})
test('Origin 없는 호출(서버 대 서버)은 통과', async () => {
  const r = await w.fetch(req('/api/dart/company?corp=1'), {})
  eq(r.status, 500)
})
test('OPTIONS 프리플라이트는 204', async () => {
  const r = await w.fetch(new Request('https://x/api/nps/timeline', { method: 'OPTIONS', headers: { origin: 'https://dart.sanghak.kr' } }), { NPS_API_KEY: 'k' })
  eq(r.status, 204)
})
test('키 없을 때 안내 문구', async () => {
  const r = await w.fetch(req('/api/nps/timeline?name=x', 'https://dart.sanghak.kr'), {})
  const b = await r.json()
  if (!/NPS_API_KEY/.test(b.error)) throw new Error(`문구: ${b.error}`)
})


// 본문을 읽고도 원본 Response 를 돌려주는 바람에, 지울 게 없는 오류 응답이
// 통째로 비어 나갔다. 사용자에게는 안내 문구 대신 "요청 실패 (400)" 만 보였다.
test('오류 응답은 스크럽 뒤에도 읽을 수 있다', async () => {
  const env = { NPS_API_KEY: 'n'.repeat(40) }
  const r = await w.fetch(req('/api/nps/timeline', 'https://dart.sanghak.kr'), env)
  eq(r.status, 400)
  const b = await r.json()
  if (!/name/.test(b.error)) throw new Error(`문구가 사라졌다: ${JSON.stringify(b)}`)
})
test('오류 응답에서 인증키를 지운다', async () => {
  // 상류 오류 메시지에 인증키가 박힌 URL 이 실려 나온 적이 있다. 여기서는
  // 키를 그대로 담은 404 문구로 대신 확인한다(상류를 부르지 않는다).
  const key = 'k'.repeat(40)
  const r = await w.fetch(req(`/api/kipris/${key}`, 'https://dart.sanghak.kr'), { KIPRIS_API_KEY: key })
  eq(r.status, 404)
  const text = await r.text()
  if (text.includes(key)) throw new Error('인증키가 그대로 나갔다')
  if (!text.includes('<KEY>')) throw new Error(`가려진 흔적이 없다: ${text}`)
})
test('/api/health 도 오리진 제한을 받는다', async () => {
  const r = await w.fetch(req('/api/health', 'https://evil.example.com'), { DART_API_KEY: 'x' })
  eq(r.status, 403)
  eq(r.headers.get('access-control-allow-origin'), null)
})
