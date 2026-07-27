// DART 프록시의 실제 알맹이. 개발 서버(Vite 미들웨어)와 Cloudflare Worker 가 함께 쓴다.
//
// OpenDART 는 두 가지 이유로 브라우저에서 직접 못 부른다.
//   1. CORS 헤더를 주지 않는다
//   2. 인증키가 번들에 박히면 그대로 노출된다
// 그래서 키는 이쪽에만 두고, 아래 세 경로만 열어 준다.
//
//   GET /api/dart/filings?corp=00126380[&from=20200101][&to=20261231]
//   GET /api/dart/company?corp=00126380
//   GET /api/dart/document?rcept=20260402003876      → 공시원문 XML (ZIP 해제 후)
//
// 표준 Request → Response 만 쓰므로 런타임에 의존하지 않는다.

const DART = 'https://opendart.fss.or.kr/api'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** 공시 종류: 감사보고서류만 남긴다(A = 정기공시, F = 외부감사관련). */
const AUDIT_RE = /(감사보고서|검토보고서|사업보고서|반기보고서|분기보고서)/

/**
 * 자본조달 공시. 비상장사는 투자 공시 의무가 없어 상장사에서만 나온다.
 *   유상증자결정 · 전환사채권발행결정 · 신주인수권부사채 · 교환사채 ·
 *   증권발행결과 · 전환청구권행사 · 주식매수선택권부여
 * '자기전환사채취득/매도' 는 회사가 제 사채를 되사는 것이라 조달이 아니다 — 뺀다.
 */
const FUNDING_RE =
  /(유상증자|무상증자|전환사채권발행|신주인수권부사채권발행|교환사채권발행|증권발행결과|전환청구권행사|주식매수선택권부여|현물출자|출자전환)/
const FUNDING_EXCLUDE = /자기전환사채|자기주식|사채권의취득|매도결정|만기전취득/

export function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

/**
 * 상류(opendart) 호출.
 *
 * Cloudflare Worker 에서 부르면 "Too many redirects" 로 실패한다 — 개발 서버(Node)나
 * 사무실 IP 에서는 200 이 그냥 온다. opendart 가 데이터센터 IP·빈 User-Agent 를
 * 걸러 리다이렉트로 되돌리는 것으로 보인다. 그래서
 *   1) 브라우저 같은 헤더를 붙이고
 *   2) 리다이렉트를 직접 따라가며 쿠키를 이어 준다(쿠키 한 번 받고 통과하는 형태 대응).
 * 그래도 반복되면 인증키가 들어간 URL 을 노출하지 않는 메시지로 끊는다.
 */
const UPSTREAM_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
  accept: 'application/json,text/plain,application/zip,*/*',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

export async function fetchUpstream(target) {
  let url = String(target)
  let cookie = ''
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: 'manual',
      headers: { ...UPSTREAM_HEADERS, ...(cookie ? { cookie } : {}) },
    })
    if (res.status < 300 || res.status >= 400) return res
    const loc = res.headers.get('location')
    if (!loc) return res
    const set = res.headers.get('set-cookie')
    if (set) cookie = [cookie, set.split(';')[0]].filter(Boolean).join('; ')
    url = new URL(loc, url).toString()
  }
  throw new Error(`DART 가 리다이렉트를 반복합니다 (${new URL(url).pathname}). 상류에서 요청을 차단한 것으로 보입니다.`)
}

/** ZIP 중앙 디렉터리의 끝(EOCD)을 뒤에서 찾는다. 주석이 있으면 22바이트보다 뒤에 있다. */
function findEocd(view) {
  const min = Math.max(0, view.byteLength - 0xffff - 22)
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i
  }
  return -1
}

/**
 * ZIP 에서 본문 XML 을 꺼낸다.
 *
 * 로컬 파일 헤더의 크기 필드만 믿으면 안 된다. DART 는 범용 플래그 bit 3(0x08) —
 * 즉 데이터 서술자 방식 — 으로 압축해 보내므로 로컬 헤더의 압축·원본 크기가 둘 다 0이다.
 * 그때 "남은 바이트 전부"로 폴백하면 데이터 서술자·중앙 디렉터리·EOCD 까지 압축
 * 스트림에 밀려들어가 "Trailing junk found after the end of the compressed stream"
 * 으로 터진다. 실제 크기는 중앙 디렉터리에만 들어 있으므로 그쪽을 읽는다.
 *
 * 엔트리가 여러 개면 원본 크기가 가장 큰 것을 본문으로 본다(나머지는 첨부·서식).
 * DecompressionStream 은 Worker·Node18+·최신 브라우저 모두 지원한다.
 */
export async function unzipMain(buf) {
  const view = new DataView(buf)
  if (view.getUint32(0, true) !== 0x04034b50) {
    // 인증 실패·없는 접수번호 등은 ZIP 이 아니라 XML 에러로 온다.
    const text = new TextDecoder('utf-8').decode(buf)
    const msg = /<message>([^<]*)<\/message>/.exec(text)?.[1]?.trim()
    const status = /<status>([^<]*)<\/status>/.exec(text)?.[1]?.trim()
    throw new Error(
      msg ? `DART: ${msg}${status ? ` (${status})` : ''}` : `DART 응답이 ZIP 이 아닙니다: ${text.slice(0, 200)}`
    )
  }

  const entries = []
  const eocd = findEocd(view)
  if (eocd >= 0) {
    const count = view.getUint16(eocd + 10, true)
    let off = view.getUint32(eocd + 16, true)
    for (let i = 0; i < count && off + 46 <= view.byteLength; i++) {
      if (view.getUint32(off, true) !== 0x02014b50) break
      const nameLen = view.getUint16(off + 28, true)
      const entry = {
        method: view.getUint16(off + 10, true),
        csize: view.getUint32(off + 20, true),
        usize: view.getUint32(off + 24, true),
        local: view.getUint32(off + 42, true),
      }
      if (entry.csize) entries.push(entry)
      off += 46 + nameLen + view.getUint16(off + 30, true) + view.getUint16(off + 32, true)
    }
  }

  // 중앙 디렉터리를 못 읽었을 때만 로컬 헤더로 폴백(크기가 실제로 적힌 옛 형식).
  if (!entries.length) {
    const csize = view.getUint32(18, true)
    if (!csize) throw new Error('DART ZIP 의 중앙 디렉터리를 읽을 수 없습니다.')
    entries.push({ method: view.getUint16(8, true), csize, usize: view.getUint32(22, true), local: 0 })
  }

  const main = entries.reduce((a, b) => (b.usize > a.usize ? b : a))
  const start = main.local + 30 + view.getUint16(main.local + 26, true) + view.getUint16(main.local + 28, true)
  const body = buf.slice(start, start + main.csize)
  if (main.method === 0) return body
  if (main.method !== 8) throw new Error(`지원하지 않는 ZIP 압축 방식입니다 (method ${main.method}).`)
  const stream = new Blob([body]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return await new Response(stream).arrayBuffer()
}

/**
 * DART 원문 디코딩.
 *
 * XML 선언의 encoding 을 믿으면 안 된다 — 실제로는 UTF-8 인데 euc-kr 로 선언된
 * 옛 문서가 있고, 그대로 따르면 한글이 전부 "占쏙옙" 로 깨진다(숫자만 멀쩡해서
 * 눈에 잘 안 띈다). 바이트를 직접 보고 판별한다.
 *
 * EUC-KR 바이트열은 UTF-8 로 엄격 디코딩하면 거의 반드시 실패하므로,
 * UTF-8 을 fatal 로 먼저 시도하고 실패할 때만 EUC-KR 로 넘어간다.
 */
function decodeDart(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(buf)
    } catch {
      return new TextDecoder('utf-8').decode(buf)
    }
  }
}

/** 유형별 100건이 넘어가면 조용히 잘리므로 최대 이 페이지 수까지 이어 받는다(유형당 300건). */
const MAX_PAGES = 3

/**
 * 공시 목록을 유형(pblntf_ty) 하나에 대해 받아온다. 최신순이라 첫 페이지가 가장 최근이다.
 * @returns {Promise<{rows: object[], truncated: boolean, error?: string}>}
 */
async function listAll(base, ty, key) {
  const rows = []
  let totalPage = 1
  for (let page = 1; page <= Math.min(totalPage, MAX_PAGES); page++) {
    const d = await dartJson('list.json', { ...base, pblntf_ty: ty, page_no: String(page) }, key)
    // 013 = 조회된 데이터 없음. 오류가 아니라 '해당 유형 공시 없음'이다.
    if (d.status === '013') break
    if (d.status !== '000') return { rows, truncated: false, error: `${d.status} ${d.message}` }
    rows.push(...(d.list || []))
    totalPage = Number(d.total_page) || 1
  }
  return { rows, truncated: totalPage > MAX_PAGES }
}

async function dartJson(path, params, key) {
  const url = new URL(`${DART}/${path}`)
  url.searchParams.set('crtfc_key', key)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v)
  const res = await fetchUpstream(url)
  if (!res.ok) throw new Error(`DART HTTP ${res.status}`)
  return res.json()
}

/**
 * @param {Request} req
 * @param {string} key  OpenDART 인증키
 * @returns {Promise<Response|null>}  /api/dart/* 가 아니면 null
 */
export async function handleDart(req, key) {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/dart/')) return null

  const cors = corsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!key) return json({ error: 'DART_API_KEY 가 서버에 설정되지 않았습니다.' }, 500, cors)

  const op = url.pathname.slice('/api/dart/'.length)
  const q = url.searchParams

  try {
    if (op === 'company') {
      const corp = q.get('corp')
      if (!corp) return json({ error: 'corp 파라미터가 필요합니다.' }, 400, cors)
      const d = await dartJson('company.json', { corp_code: corp }, key)
      if (d.status !== '000') return json({ error: `${d.status} ${d.message}` }, 502, cors)
      return json(d, 200, cors)
    }

    if (op === 'filings') {
      const corp = q.get('corp')
      if (!corp) return json({ error: 'corp 파라미터가 필요합니다.' }, 400, cors)
      const base = {
        corp_code: corp,
        bgn_de: q.get('from') || '20150101',
        end_de: q.get('to') || ymd(new Date()),
        page_count: '100',
      }

      // 공시유형으로 상류에서 걸러야 한다.
      // 유형 없이 받으면 최근 100건만 오고, 대형사는 그게 전부 지분·수시공시라
      // 감사보고서가 한 건도 안 걸린다(삼성전자 전체 4,646건 중 최근 100건).
      //   A = 정기공시(사업·반기·분기보고서), F = 외부감사관련(감사보고서·연결감사보고서)
      const pages = await Promise.all(['F', 'A'].map((ty) => listAll(base, ty, key)))

      const rows = []
      let truncated = false
      for (const p of pages) {
        if (p.error) return json({ error: p.error }, 502, cors)
        rows.push(...p.rows)
        truncated = truncated || p.truncated
      }

      const seen = new Set()
      const list = rows
        .filter((r) => AUDIT_RE.test(r.report_nm || ''))
        .filter((r) => (seen.has(r.rcept_no) ? false : seen.add(r.rcept_no)))
        .sort((a, b) => String(b.rcept_dt).localeCompare(String(a.rcept_dt)))
        .map((r) => ({
          rceptNo: r.rcept_no,
          reportNm: (r.report_nm || '').trim(),
          rceptDt: r.rcept_dt,
          flrNm: r.flr_nm,
          corpName: r.corp_name,
        }))
      return json({ total: list.length, list, truncated }, 200, cors)
    }

    if (op === 'funding') {
      const corp = q.get('corp')
      if (!corp) return json({ error: 'corp 파라미터가 필요합니다.' }, 400, cors)
      const base = {
        corp_code: corp,
        bgn_de: q.get('from') || '20150101',
        end_de: q.get('to') || ymd(new Date()),
        page_count: '100',
      }
      // B = 발행공시(주요사항보고서), I = 거래소공시(증권발행결과·전환청구권행사 등)
      const pages = await Promise.all(['B', 'I'].map((ty) => listAll(base, ty, key)))

      const rows = []
      let truncated = false
      for (const p of pages) {
        if (p.error) return json({ error: p.error }, 502, cors)
        rows.push(...p.rows)
        truncated = truncated || p.truncated
      }

      const seen = new Set()
      const list = rows
        .filter((r) => FUNDING_RE.test(r.report_nm || '') && !FUNDING_EXCLUDE.test(r.report_nm || ''))
        .filter((r) => (seen.has(r.rcept_no) ? false : seen.add(r.rcept_no)))
        .sort((a, b) => String(b.rcept_dt).localeCompare(String(a.rcept_dt)))
        .map((r) => ({
          rceptNo: r.rcept_no,
          reportNm: (r.report_nm || '').replace(/\s+/g, ' ').trim(),
          rceptDt: r.rcept_dt,
          kind: fundingKind(r.report_nm || ''),
          isAmendment: /\[(기재정정|첨부정정|첨부추가|정정)\]/.test(r.report_nm || ''),
        }))
      return json({ total: list.length, list, truncated }, 200, cors)
    }

    if (op === 'document') {
      const rcept = q.get('rcept')
      if (!/^\d{14}$/.test(rcept || '')) return json({ error: 'rcept(접수번호 14자리)가 필요합니다.' }, 400, cors)
      const durl = new URL(`${DART}/document.xml`)
      durl.searchParams.set('crtfc_key', key)
      durl.searchParams.set('rcept_no', rcept)
      const res = await fetchUpstream(durl)
      if (!res.ok) throw new Error(`DART HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const xml = decodeDart(await unzipMain(buf))
      return new Response(xml, {
        status: 200,
        headers: { 'content-type': 'text/xml; charset=utf-8', ...cors },
      })
    }

    return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

/** 공시명 → 조달 수단. 화면에서 묶어 보여 주고 색을 나누는 데 쓴다. */
function fundingKind(name) {
  if (/전환사채/.test(name)) return 'CB'
  if (/신주인수권부사채/.test(name)) return 'BW'
  if (/교환사채/.test(name)) return 'EB'
  if (/무상증자/.test(name)) return '무상증자'
  if (/유상증자/.test(name)) return '유상증자'
  if (/전환청구권행사/.test(name)) return '전환청구'
  if (/주식매수선택권/.test(name)) return '스톡옵션'
  if (/증권발행결과/.test(name)) return '발행결과'
  return '기타'
}

function ymd(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}
