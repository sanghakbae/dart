// 인증키 출처 결정 규칙.
//
// DB(관리자 페이지 등록) → 환경 시크릿 순으로 쓴다. DB 조회가 실패하거나
// 서비스 계정이 없어도 조회 기능이 멈추면 안 되므로, 그때는 환경값으로 돌아간다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveKeys, parseServiceAccount, resetKeyCache, KEY_NAMES } from '../server/api-keys.mjs'

/** 서명 경로까지 실제로 태우기 위해 진짜 RSA 키를 만들어 PEM 으로 넘긴다. */
async function testServiceAccount() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey)
  const b64 = Buffer.from(pkcs8).toString('base64').replace(/(.{64})/g, '$1\n')
  return {
    client_email: 'a@b.c',
    project_id: 'proj',
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  }
}

const ENV = {
  DART_API_KEY: 'env-dart',
  NPS_API_KEY: 'env-nps',
  KIPRIS_API_KEY: 'env-kipris',
}

test('서비스 계정이 없으면 환경 시크릿을 그대로 쓴다', async () => {
  resetKeyCache()
  const keys = await resolveKeys(ENV)
  assert.deepEqual(keys, ENV)
})

test('네 개 키를 모두 돌려준다 — 없는 것은 빈 문자열', async () => {
  resetKeyCache()
  const keys = await resolveKeys({ DART_API_KEY: 'only-dart' })
  assert.deepEqual(Object.keys(keys).sort(), [...KEY_NAMES].sort())
  assert.equal(keys.DART_API_KEY, 'only-dart')
  assert.equal(keys.NPS_API_KEY, '')
})

test('env 자체가 없어도 터지지 않는다', async () => {
  resetKeyCache()
  const keys = await resolveKeys(undefined)
  assert.equal(keys.DART_API_KEY, '')
})

test('서비스 계정 JSON — 필드가 빠지면 무효로 본다', () => {
  assert.equal(parseServiceAccount(null), null)
  assert.equal(parseServiceAccount('그냥 문자열'), null)
  assert.equal(parseServiceAccount('{"client_email":"a@b.c"}'), null) // private_key·project_id 없음
  assert.equal(parseServiceAccount(JSON.stringify({ client_email: 'a@b.c', private_key: 'k' })), null)
})

test('서비스 계정 JSON — 문자열과 객체를 모두 받는다', () => {
  const sa = { client_email: 'a@b.c', private_key: 'k', project_id: 'p' }
  assert.deepEqual(parseServiceAccount(JSON.stringify(sa)), sa)
  assert.deepEqual(parseServiceAccount(sa), sa)
})

test('DB 값이 있으면 환경값을 이긴다', async () => {
  resetKeyCache()
  const sa = await testServiceAccount()
  const real = globalThis.fetch
  globalThis.fetch = async (url) => {
    if (String(url).includes('oauth2.googleapis.com')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
    }
    return new Response(
      JSON.stringify({ fields: { DART_API_KEY: { stringValue: 'db-dart' } } }),
      { status: 200 }
    )
  }
  try {
    const keys = await resolveKeys({ ...ENV, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) })
    assert.equal(keys.DART_API_KEY, 'db-dart') // DB 우선
    assert.equal(keys.NPS_API_KEY, 'env-nps') // DB 에 없는 것은 환경값
  } finally {
    globalThis.fetch = real
    resetKeyCache()
  }
})

test('DB 에 빈 값으로 등록 해제하면 환경값으로 돌아간다', async () => {
  resetKeyCache()
  const sa = await testServiceAccount()
  const real = globalThis.fetch
  globalThis.fetch = async (url) =>
    String(url).includes('oauth2.googleapis.com')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      : new Response(JSON.stringify({ fields: { DART_API_KEY: { stringValue: '  ' } } }), { status: 200 })
  try {
    const keys = await resolveKeys({ ...ENV, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) })
    assert.equal(keys.DART_API_KEY, 'env-dart')
  } finally {
    globalThis.fetch = real
    resetKeyCache()
  }
})

test('문서가 아직 없으면(404) 오류가 아니라 미등록으로 본다', async () => {
  resetKeyCache()
  const sa = await testServiceAccount()
  const real = globalThis.fetch
  globalThis.fetch = async (url) =>
    String(url).includes('oauth2.googleapis.com')
      ? new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 })
      : new Response('{}', { status: 404 })
  try {
    const keys = await resolveKeys({ ...ENV, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) })
    assert.equal(keys.DART_API_KEY, 'env-dart')
  } finally {
    globalThis.fetch = real
    resetKeyCache()
  }
})

test('DB 조회가 실패해도 환경값으로 계속 동작한다', async () => {
  resetKeyCache()
  const sa = await testServiceAccount()
  const real = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('네트워크 끊김')
  }
  try {
    const keys = await resolveKeys({ ...ENV, FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) })
    assert.deepEqual(keys, ENV)
  } finally {
    globalThis.fetch = real
    resetKeyCache()
  }
})
