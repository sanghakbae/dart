// 국민연금 프록시 — data.go.kr 게이트웨이 오류 처리.
//
// 상류가 간헐적으로 503 SERVICETIMEOUT_ERROR 를 던진다. 시계열은 월마다 두 번씩
// 부르므로(13개월 = 26회) 한 번의 딸꾹질에 통째로 실패하면 고용 탭이 거의 늘 비어 있다.
// 게다가 이 오류는 공단 형식이 아니라 게이트웨이가 감싼 OpenAPI_ServiceResponse 로
// 오고 200 으로 올 때도 있어, 안 보면 '사업장 없음' 으로 조용히 넘어간다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleNps } from '../server/nps-handler.mjs'

const req = (path) => new Request(`https://proxy.example.dev${path}`)

const TIMEOUT_BODY = JSON.stringify({
  OpenAPI_ServiceResponse: {
    cmmMsgHeader: { errMsg: 'SERVICETIMEOUT_ERROR', returnAuthMsg: '서비스 연결이 지연되었습니다.', returnReasonCode: '30' },
  },
})
const LIMIT_BODY = JSON.stringify({
  OpenAPI_ServiceResponse: {
    cmmMsgHeader: { errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR', returnReasonCode: '22' },
  },
})
const ok = (items) =>
  new Response(JSON.stringify({ response: { header: { resultCode: '00' }, body: { items: { item: items } } } }), { status: 200 })

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = real
  }
}

const ROW = {
  bzowrRgstNo: '206865****',
  wkplNm: '주식회사 무하유',
  wkplRoadNmDtlAddr: '서울특별시 성동구',
  wkplJnngStcd: '1',
  jnngpCnt: '104',
  dataCrtYm: '202605',
  seq: '1',
}

test('503 SERVICETIMEOUT 은 다시 불러 본다', async () => {
  let calls = 0
  const r = await withFetch(
    async () => {
      calls++
      return calls === 1 ? new Response(TIMEOUT_BODY, { status: 503 }) : ok([ROW])
    },
    () => handleNps(req('/api/nps/search?name=무하유'), 'k')
  )
  assert.equal(r.status, 200)
  assert.equal((await r.json()).total, 1)
  assert.ok(calls >= 2, '재시도가 없었다')
})

test('200 으로 감싸 온 게이트웨이 오류를 사업장 없음으로 넘기지 않는다', async () => {
  // 상태코드가 200 이라 예전에는 items 가 비어 있는 것으로 읽혀,
  // 멀쩡한 회사가 '사업장을 찾지 못했습니다' 로 보였다.
  const r = await withFetch(
    async () => new Response(TIMEOUT_BODY, { status: 200 }),
    () => handleNps(req('/api/nps/search?name=무하유'), 'k')
  )
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /SERVICETIMEOUT/)
})

test('계속 실패하면 무엇이 문제인지 알려준다', async () => {
  const r = await withFetch(
    async () => new Response(TIMEOUT_BODY, { status: 503 }),
    () => handleNps(req('/api/nps/search?name=무하유'), 'k')
  )
  assert.equal(r.status, 502)
  // 원문 JSON 을 그대로 토해내지 않고 사람이 읽을 문장을 준다.
  assert.match((await r.json()).error, /공단 서버가 제때 응답하지 않았습니다/)
})

test('한도 초과는 다시 부르지 않는다', async () => {
  // 다시 불러도 같은 답이 온다. 재시도는 한도만 더 태운다.
  let calls = 0
  const r = await withFetch(
    async () => {
      calls++
      return new Response(LIMIT_BODY, { status: 200 })
    },
    () => handleNps(req('/api/nps/search?name=무하유'), 'k')
  )
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /한도/)
  assert.equal(calls, 1)
})

test('표기 하나가 실패해도 다른 표기로 찾는다', async () => {
  // '주식회사 무하유' 는 '주식회사 무하유' · '주식회사무하유' 두 표기로 조회된다.
  // 앞의 것이 죽었다고 뒤의 것까지 포기하면 멀쩡한 조회가 실패한다.
  let n = 0
  const r = await withFetch(
    async () => {
      n++
      // 첫 표기는 재시도까지 모두 실패시킨다(RETRY_MS 는 2회 → 호출 3회).
      return n <= 3 ? new Response(TIMEOUT_BODY, { status: 503 }) : ok([ROW])
    },
    () => handleNps(req('/api/nps/search?name=주식회사 무하유'), 'k')
  )
  assert.equal(r.status, 200)
  assert.equal((await r.json()).total, 1)
})
