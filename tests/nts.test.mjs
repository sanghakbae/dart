// 국세청 사업자등록정보 상태조회 프록시.
//
// 다른 공공데이터와 달리 POST 이고, 본문에 사업자번호 배열을 넣는다. 실수를
// 붙잡아 두려고 요청 형태와 응답 정규화를 함께 본다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleNts, normalizeBizNo, formatBizNo } from '../server/nts-handler.mjs'

const req = (path) => new Request(`https://proxy.example.dev${path}`)

test('사업자번호 — 하이픈을 떼고 10자리만 받는다', () => {
  assert.equal(normalizeBizNo('120-87-97004'), '1208797004')
  assert.equal(normalizeBizNo(' 1208797004 '), '1208797004')
  assert.equal(normalizeBizNo('12087970'), null)
  assert.equal(formatBizNo('1208797004'), '120-87-97004')
})

test('키가 없으면 500', async () => {
  const r = await handleNts(req('/api/nts/status?bizNo=1208797004'), '')
  assert.equal(r.status, 500)
})

test('사업자번호가 없거나 자릿수가 다르면 400', async () => {
  assert.equal((await handleNts(req('/api/nts/status'), 'k')).status, 400)
  assert.equal((await handleNts(req('/api/nts/status?bizNo=123'), 'k')).status, 400)
})

test('모르는 경로는 404, 다른 경로는 넘긴다', async () => {
  assert.equal((await handleNts(req('/api/nts/nope'), 'k')).status, 404)
  assert.equal(await handleNts(req('/api/dart/company?corp=1'), 'k'), null)
})

// ── 상류 호출 형태와 응답 정규화 ─────────────────────────────
const withFetch = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = real
  }
}

const okBody = (row) => new Response(JSON.stringify({ status_code: 'OK', data: [row] }), { status: 200 })

test('POST 로 부르고 사업자번호는 본문에 넣는다', async () => {
  let seen = null
  const r = await withFetch(
    async (url, init) => {
      seen = { url: new URL(url), init }
      return okBody({ b_no: '1208797004', b_stt: '계속사업자', b_stt_cd: '01' })
    },
    () => handleNts(req('/api/nts/status?bizNo=120-87-97004'), 'secret-key')
  )

  assert.equal(r.status, 200)
  assert.equal(seen.init.method, 'POST')
  // 인증키만 쿼리스트링, 사업자번호는 본문이다.
  assert.equal(seen.url.searchParams.get('serviceKey'), 'secret-key')
  assert.equal(seen.url.searchParams.get('b_no'), null)
  assert.deepEqual(JSON.parse(seen.init.body), { b_no: ['1208797004'] })
})

test('계속사업자를 정규화한다', async () => {
  const r = await withFetch(
    async () => okBody({
      b_no: '1208797004', b_stt: '계속사업자', b_stt_cd: '01',
      tax_type: '부가가치세 일반과세자', tax_type_cd: '01', end_dt: '',
    }),
    () => handleNts(req('/api/nts/status?bizNo=1208797004'), 'k')
  )
  const d = await r.json()
  assert.equal(d.known, true)
  assert.equal(d.status, '계속사업자')
  assert.equal(d.statusCode, '01')
  assert.equal(d.taxType, '부가가치세 일반과세자')
  assert.equal(d.closedAt, null)
  assert.equal(d.bizNoText, '120-87-97004')
})

test('폐업자는 폐업일을 날짜로 돌려준다', async () => {
  const r = await withFetch(
    async () => okBody({ b_no: '1208797004', b_stt: '폐업자', b_stt_cd: '03', end_dt: '20240930' }),
    () => handleNts(req('/api/nts/status?bizNo=1208797004'), 'k')
  )
  const d = await r.json()
  assert.equal(d.statusCode, '03')
  assert.equal(d.closedAt, '2024-09-30')
})

test('등록되지 않은 번호는 오류가 아니라 known=false', async () => {
  const r = await withFetch(
    async () => okBody({ b_no: '0000000000', b_stt: '', tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.' }),
    () => handleNts(req('/api/nts/status?bizNo=0000000000'), 'k')
  )
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(d.known, false)
  assert.equal(d.status, null)
  assert.match(d.message, /등록되지 않은/)
})

test('활용신청이 안 된 키(-4)는 무엇을 해야 하는지 알려준다', async () => {
  const r = await withFetch(
    async () => new Response(JSON.stringify({ code: -4, msg: '등록되지 않은 인증키 입니다.' }), { status: 200 }),
    () => handleNts(req('/api/nts/status?bizNo=1208797004'), 'k')
  )
  assert.equal(r.status, 502)
  const d = await r.json()
  assert.match(d.error, /활용신청/)
})
