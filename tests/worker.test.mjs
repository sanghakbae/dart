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
  eq(await r.json(), { ok: true, dart: false, nps: false })
})
test('health — 키가 있으면 true', async () => {
  const r = await w.fetch(req('/health'), { DART_API_KEY: 'x', NPS_API_KEY: 'y' })
  eq((await r.json()), { ok: true, dart: true, nps: true })
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


