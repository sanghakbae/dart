// Functions 배포 형태에 따라 함수 이름이 경로에 끼거나 빠진다.
// 앞부분을 가정하면 배포하자마자 404 가 나므로, 형태별로 굳혀 둔다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apiPathOf, apiUrlOf } from '../server/api-path.mjs'

test('cloudfunctions.net — 함수 이름이 앞에 붙는 형태', () => {
  assert.equal(apiPathOf('/api/api/nps/timeline'), '/api/nps/timeline')
})

test('Hosting rewrite — 함수 이름이 없는 형태', () => {
  assert.equal(apiPathOf('/api/nps/timeline'), '/api/nps/timeline')
})

test('쿼리는 떼고 경로만 본다', () => {
  assert.equal(apiPathOf('/api/nps/search?name=%EB%AC%B4%ED%95%98%EC%9C%A0'), '/api/nps/search')
})

test('다른 상류 경로도 같은 규칙', () => {
  assert.equal(apiPathOf('/anything/api/dart/filings'), '/api/dart/filings')
  assert.equal(apiPathOf('/api/health'), '/api/health')
})

test('아는 접두사가 없으면 그대로 둔다', () => {
  assert.equal(apiPathOf('/nope'), '/nope')
  assert.equal(apiPathOf(''), '')
  assert.equal(apiPathOf(undefined), '')
})

test('쿼리를 붙여 원래 요청을 되살린다', () => {
  assert.equal(
    apiUrlOf({ originalUrl: '/api/api/nps/timeline?name=%EA%B0%80&months=24' }),
    '/api/nps/timeline?name=%EA%B0%80&months=24'
  )
  assert.equal(apiUrlOf({ url: '/api/nps/search' }), '/api/nps/search')
})
