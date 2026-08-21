// DART 공시 목록의 연간/분기·반기 분류.
// 이 앱은 연 1회 감사받은 재무제표만 쓴다 — 상장사는 사업보고서, 비상장사는 감사보고서.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filingKind } from '../server/dart-handler.mjs'
import { filingPeriodKey, filingBasisCode, rceptNoForReport } from '../src/lib/dart/filingKind.js'

test('상장사 사업보고서는 연간', () => {
  assert.equal(filingKind('사업보고서 (2025.12)'), 'annual')
})
test('비상장사 감사보고서·연결감사보고서는 연간', () => {
  assert.equal(filingKind('감사보고서'), 'annual')
  assert.equal(filingKind('[기재정정]연결감사보고서'), 'annual')
})
test('분기보고서는 quarter', () => {
  assert.equal(filingKind('분기보고서 (2025.03)'), 'quarter')
})
test('반기보고서는 half', () => {
  assert.equal(filingKind('반기보고서 (2025.06)'), 'half')
})
// '반기검토보고서' 에도 '검토보고서' 가 들어 있어, 반기·분기를 먼저 걸러야
// 연간으로 새지 않는다.
test('반기검토보고서가 연간으로 새지 않는다', () => {
  assert.equal(filingKind('반기검토보고서'), 'half')
  assert.equal(filingKind('분기검토보고서'), 'quarter')
})

// mapFilings 는 내부에서 filingKind 를 부른다. 재수출만 해 두면 이 함수 안에서
// 이름을 못 찾아 런타임에 "filingKind is not defined" 로 터진다(배포본에서 겪음).
// 네트워크 없이 그 경로를 그대로 밟아 확인한다.
import { mapFilings } from '../server/dart-handler.mjs'

test('mapFilings — 감사보고서류만 남기고 kind 를 붙인다', () => {
  const rows = [
    { rcept_no: '1', report_nm: '사업보고서 (2025.12)', rcept_dt: '20260318', corp_name: '두산퓨얼셀' },
    { rcept_no: '2', report_nm: '분기보고서 (2026.03)', rcept_dt: '20260515' },
    { rcept_no: '3', report_nm: '최대주주등소유주식변동신고서', rcept_dt: '20260101' }, // 감사류 아님 → 제외
    { rcept_no: '2', report_nm: '분기보고서 (2026.03)', rcept_dt: '20260515' }, // 중복
  ]
  const list = mapFilings(rows)
  assert.equal(list.length, 2) // 신고서 제외 + 중복 제거
  assert.equal(list[0].reportNm, '분기보고서 (2026.03)') // 최신순
  assert.equal(list.find((f) => f.rceptNo === '1').kind, 'annual')
  assert.equal(list.find((f) => f.rceptNo === '2').kind, 'quarter')
})

test('mapFilings — 빈 입력도 안전', () => {
  assert.deepEqual(mapFilings(), [])
})

// ── 이미 받아 둔 공시 잠그기 ──────────────────────────────
// 목록만 보고는 무엇을 받았는지 알 수 없어 같은 것을 또 눌러 보게 됐다.
// 저장된 보고서 ID(연도-기간종류-연결여부)와 맞추려면 공시 이름에서 앞부분을 뽑아야 한다.
test('기간 키 — 결산월로 기간종류를 가른다', () => {
  assert.equal(filingPeriodKey('감사보고서 (2025.12)'), '2025-FY')
  assert.equal(filingPeriodKey('사업보고서 (2025.12)'), '2025-FY')
  assert.equal(filingPeriodKey('반기보고서 (2025.06)'), '2025-H1')
  assert.equal(filingPeriodKey('분기보고서 (2025.09)'), '2025-Q3')
  assert.equal(filingPeriodKey('분기보고서 (2025.03)'), '2025-Q1')
})

test('기간 키 — 정정 말머리가 붙어도 같은 기간이다', () => {
  // 원본과 정정본은 같은 보고서다. 원본을 받아 뒀으면 정정본도 잠겨야 한다
  // (같은 ID 로 덮어쓰므로 새 보고서가 생기지 않는다).
  assert.equal(filingPeriodKey('[기재정정]사업보고서 (2015.12)'), '2015-FY')
  assert.equal(filingPeriodKey('[첨부정정]감사보고서 (2018.12)'), '2018-FY')
})

test('기간 키 — 연도를 못 찾으면 null (잠그지 않는다)', () => {
  assert.equal(filingPeriodKey('감사보고서'), null)
  assert.equal(filingPeriodKey(''), null)
})

test('기간 키 — 12·6·9·3 이 아닌 결산월은 이름으로 가른다', () => {
  assert.equal(filingPeriodKey('사업보고서 (2025.02)'), '2025-FY')
  assert.equal(filingPeriodKey('무슨보고서 (2025.02)'), null)
})

test('연결여부 — 이름에 연결이 있으면 c, 감사보고서는 s, 사업보고서는 모른다', () => {
  assert.equal(filingBasisCode('연결감사보고서 (2025.12)'), 'c')
  assert.equal(filingBasisCode('[기재정정]연결감사보고서'), 'c')
  assert.equal(filingBasisCode('감사보고서 (2025.12)'), 's')
  // 사업보고서는 연결·별도를 한 건에 함께 실어 어느 쪽으로 저장될지 모른다.
  assert.equal(filingBasisCode('사업보고서 (2025.12)'), null)
})

test('잠금 — 별도를 받아 뒀다고 연결까지 잠기지 않는다', () => {
  // 「감사보고서」와 「연결감사보고서」는 다른 문서다. 별도만 받은 상태에서
  // 연결까지 잠그면 연결을 영영 받을 수 없다.
  const have = new Set(['2025-FY-s'])
  const done = (nm) => {
    const k = filingPeriodKey(nm)
    const code = filingBasisCode(nm)
    return code ? have.has(`${k}-${code}`) : have.has(`${k}-s`) || have.has(`${k}-c`)
  }
  assert.equal(done('감사보고서 (2025.12)'), true)
  assert.equal(done('연결감사보고서 (2025.12)'), false)
  // 사업보고서는 어느 쪽이든 있으면 받은 것으로 본다.
  assert.equal(done('사업보고서 (2025.12)'), true)
  assert.equal(done('사업보고서 (2024.12)'), false)
})

// ── DART PDF 경로 ────────────────────────────────────────
// 접수번호만으로는 PDF 를 받을 수 없다. 뷰어에서 dcmNo 와 세션 쿠키를 얻고,
// 다운로드 안내 페이지를 한 번 거쳐야 pdf.do 가 실제 바이트를 준다.
import { handleDart } from '../server/dart-handler.mjs'

const dreq = (path) => new Request(`https://proxy.example.dev${path}`)
const swap = async (impl, fn) => {
  const real = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = real
  }
}

test('PDF — 접수번호 14자리가 아니면 400', async () => {
  const r = await handleDart(dreq('/api/dart/pdf?rcept=123'), 'k')
  assert.equal(r.status, 400)
})

test('PDF — 뷰어·안내를 거쳐 받고 쿠키를 물려 보낸다', async () => {
  const seen = []
  const r = await swap(
    async (url, init) => {
      const u = new URL(url)
      seen.push({ path: u.pathname, cookie: init?.headers?.cookie || '', referer: init?.headers?.referer || '' })
      if (u.pathname === '/dsaf001/main.do') {
        return new Response('<a href="/x?dcmNo=777">문서</a>', {
          status: 200,
          headers: { 'set-cookie': 'JSESSIONID=abc; Path=/' },
        })
      }
      if (u.pathname === '/pdf/download/main.do') {
        // 걸음마다 세션이 갱신될 수 있다 — 이름이 같으면 덮어써야 한다.
        return new Response('<html/>', { status: 200, headers: { 'set-cookie': 'JSESSIONID=def; Path=/' } })
      }
      return new Response(new TextEncoder().encode('%PDF-1.4 ...'), { status: 200 })
    },
    () => handleDart(dreq('/api/dart/pdf?rcept=20260305000879'), 'k')
  )

  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/pdf')
  assert.deepEqual(seen.map((s) => s.path), ['/dsaf001/main.do', '/pdf/download/main.do', '/pdf/download/pdf.do'])
  // 같은 이름 쿠키가 쌓이지 않고 마지막 값으로 덮인다.
  assert.equal(seen[2].cookie, 'JSESSIONID=def')
  assert.ok(seen[2].referer.includes('/pdf/download/main.do'))
})

test('PDF — dcmNo 가 없으면 무엇이 없는지 알려준다', async () => {
  const r = await swap(
    async () => new Response('<html>문서번호 없음</html>', { status: 200 }),
    () => handleDart(dreq('/api/dart/pdf?rcept=20260305000879'), 'k')
  )
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /dcmNo/)
})

test('PDF — 200 인데 PDF 가 아니면 성공으로 넘기지 않는다', async () => {
  // 세션이 없으면 DART 가 200 에 0바이트를 준다. 그대로 흘리면 빈 뷰어가 뜬다.
  const r = await swap(
    async (url) => {
      const u = new URL(url)
      if (u.pathname === '/dsaf001/main.do') return new Response('<a href="?dcmNo=1">x</a>', { status: 200 })
      if (u.pathname === '/pdf/download/main.do') return new Response('<html/>', { status: 200 })
      return new Response(new Uint8Array(0), { status: 200 })
    },
    () => handleDart(dreq('/api/dart/pdf?rcept=20260305000879'), 'k')
  )
  assert.equal(r.status, 502)
  assert.match((await r.json()).error, /빈 PDF/)
})

// ── 접수번호 채우기 ──────────────────────────────────────
// 접수번호는 나중에 저장하기 시작했다. 먼저 올린 보고서는 원문 PDF 를 못 여는데,
// 원문을 다시 받을 필요는 없다 — 공시 목록에서 같은 기간·기준의 번호만 얹으면 된다.
const FILINGS = [
  { reportNm: '감사보고서 (2025.12)', rceptNo: '20260305000879', rceptDt: '20260305' },
  { reportNm: '연결감사보고서 (2025.12)', rceptNo: '20260305111111', rceptDt: '20260305' },
  { reportNm: '[기재정정]사업보고서 (2021.12)', rceptNo: '20220324000472', rceptDt: '20220324' },
  { reportNm: '사업보고서 (2021.12)', rceptNo: '20220318001076', rceptDt: '20220318' },
  { reportNm: '반기보고서 (2025.06)', rceptNo: '20250814003390', rceptDt: '20250814' },
]

test('접수번호 — 같은 기간·기준의 공시를 고른다', () => {
  assert.equal(rceptNoForReport('2025-FY-s', FILINGS), '20260305000879')
  assert.equal(rceptNoForReport('2025-FY-c', FILINGS), '20260305111111')
  assert.equal(rceptNoForReport('2025-H1-s', FILINGS), '20250814003390')
})

test('접수번호 — 정정본이 원본을 이긴다', () => {
  // 저장소도 정정본을 우선하므로(amendment-kept) 화면 수치와 PDF 가 어긋나지 않는다.
  assert.equal(rceptNoForReport('2021-FY-s', FILINGS), '20220324000472')
  assert.equal(rceptNoForReport('2021-FY-c', FILINGS), '20220324000472')
})

test('접수번호 — 맞는 공시가 없으면 채우지 않는다', () => {
  assert.equal(rceptNoForReport('2019-FY-s', FILINGS), null)
  assert.equal(rceptNoForReport('2025-Q1-s', FILINGS), null)
})

test('접수번호 — 보고서 ID 형식이 아니면 건드리지 않는다', () => {
  assert.equal(rceptNoForReport('', FILINGS), null)
  assert.equal(rceptNoForReport('2025-FY', FILINGS), null)
  assert.equal(rceptNoForReport('na-FY-s', FILINGS), null)
  assert.equal(rceptNoForReport('2025-FY-s', []), null)
})

test('접수번호 — 14자리가 아니면 버린다', () => {
  assert.equal(rceptNoForReport('2025-FY-s', [{ reportNm: '감사보고서 (2025.12)', rceptNo: '123', rceptDt: '20260305' }]), null)
})
