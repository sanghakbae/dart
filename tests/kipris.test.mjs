// KIPRIS 페이징 — 상류가 docsCount 를 지켜 줄 때와 30 으로 깎을 때 모두 옳아야 한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleKipris } from '../server/kipris-handler.mjs'

const req = (p) => new Request(`https://proxy.example.dev${p}`)
const swap = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = real }
}

/** 총 total 건을 가진 상류. cap 만큼만 한 번에 준다. */
const upstream = (total, cap, calls) => async (url) => {
  const u = new URL(url)
  const start = Number(u.searchParams.get('docsStart'))
  const want = Number(u.searchParams.get('docsCount'))
  const n = Math.max(0, Math.min(cap, want, total - start + 1))
  calls.push({ start, want, gave: n })
  const items = Array.from({ length: n }, (_, i) => `
    <PatentUtilityInfo>
      <Applicant>주식회사 무하유</Applicant>
      <InventionName>발명 ${start + i}</InventionName>
      <ApplicationNumber>10-2025-${String(start + i).padStart(7, '0')}</ApplicationNumber>
      <ApplicationDate>20250101</ApplicationDate>
    </PatentUtilityInfo>`).join('')
  return new Response(`<response><header><resultCode>00</resultCode></header>
    <body><TotalSearchCount>${total}</TotalSearchCount>${items}</body></response>`, { status: 200 })
}

test('상류가 500 을 지켜 주면 호출 한 번으로 끝난다', async () => {
  const calls = []
  const r = await swap(upstream(433, 500, calls), () => handleKipris(req('/api/kipris/patents?applicant=주식회사 무하유'), 'k'))
  const d = await r.json()
  assert.equal(d.total, 433)
  assert.equal(calls.length, 1, `호출 ${calls.length}회`)
})

test('상류가 30 으로 깎아도 전부 받는다(예전과 같은 호출 수)', async () => {
  const calls = []
  const r = await swap(upstream(433, 30, calls), () => handleKipris(req('/api/kipris/patents?applicant=주식회사 무하유'), 'k'))
  const d = await r.json()
  assert.equal(d.total, 433)
  // docsStart 가 받은 개수만큼 전진해야 겹치지도 빠지지도 않는다.
  assert.deepEqual(calls.map((c) => c.start).slice(0, 4), [1, 31, 61, 91])
  assert.equal(d.patents.length, 433)
})

test('상류가 100 으로 깎으면 그만큼 호출이 줄어든다', async () => {
  const calls = []
  const r = await swap(upstream(433, 100, calls), () => handleKipris(req('/api/kipris/patents?applicant=주식회사 무하유'), 'k'))
  assert.equal((await r.json()).total, 433)
  assert.equal(calls.length, 5) // 100·100·100·100·33
})

test('첫 호출에 우리 이름이 없으면 더 훑지 않는다', async () => {
  const calls = []
  const r = await swap(
    async (url) => {
      calls.push(1)
      return new Response(`<response><header><resultCode>00</resultCode></header><body>
        <TotalSearchCount>20000</TotalSearchCount>
        <PatentUtilityInfo><Applicant>남의회사</Applicant><ApplicationNumber>10-1</ApplicationNumber></PatentUtilityInfo>
      </body></response>`, { status: 200 })
    },
    () => handleKipris(req('/api/kipris/patents?applicant=주식회사 무하유'), 'k')
  )
  await r.json()
  // 이름 변형(2개)마다 첫 호출 한 번씩만.
  assert.ok(calls.length <= 2, `호출 ${calls.length}회`)
})

test('한도 초과는 무엇을 해야 하는지 알려준다', async () => {
  // 예전에는 LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR 를 그대로 내보냈다.
  const r = await swap(
    async () => new Response('<response><header><resultCode>22</resultCode><resultMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</resultMsg></header></response>', { status: 200 }),
    () => handleKipris(req('/api/kipris/patents?applicant=무하유'), 'k')
  )
  assert.equal(r.status, 502)
  const d = await r.json()
  assert.match(d.error, /한도를 다 썼습니다/)
  assert.match(d.error, /다음 달/)
})
