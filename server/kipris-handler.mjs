// KIPRIS Plus 특허·실용신안 프록시.
//
//   GET /api/kipris/patents?applicant=무하유[&rows=100]
//
// 주의할 점
//  - 인증 파라미터는 accessKey 다. ServiceKey 로 보내면 30(미등록 키)으로 떨어진다.
//  - 서비스를 신청하지 않으면 키가 있어도 31(사용기간 만료)로 응답한다. 200 으로 오기 때문에
//    화면에서는 '데이터 없음' 처럼 보인다 — 상태 점검(health)에서 이 코드를 구분해 준다.
//  - 엔드포인트 철자 'Sevice' 는 KIPRIS 쪽 실제 표기다(오타가 아니다).
//  - 응답이 XML 뿐이라 여기서 JSON 으로 바꿔 넘긴다.

const KIPRIS = 'http://plus.kipris.or.kr/openapi/rest/patUtiModInfoSearchSevice'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
// KIPRIS 는 한 번 부르는 데 10초를 넘기는 일이 잦다(상태 점검도 12.7초 걸렸다).
// 15초로 잡았더니 실제 조회가 전부 타임아웃으로 떨어졌다.
const TIMEOUT = 30_000

export function kiprisCors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })

/** 아주 얕은 XML 파서. 이 응답은 중첩이 한 겹뿐이라 정규식으로 충분하다. */
function pick(chunk, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(chunk)
  return m ? decode(m[1].trim()) : ''
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .normalize('NFC')
}

function toDate(s) {
  const v = String(s || '').replace(/\D/g, '')
  return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null
}

/**
 * @param {Request} req
 * @param {string} key KIPRIS Plus REST AccessKey
 * @returns {Promise<Response|null>}
 */
export async function handleKipris(req, key) {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/kipris/')) return null

  const cors = kiprisCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!key) return json({ error: 'KIPRIS_API_KEY 가 서버에 설정되지 않았습니다.' }, 500, cors)

  const op = url.pathname.slice('/api/kipris/'.length)
  if (op !== 'patents') return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)

  const applicant = url.searchParams.get('applicant')
  if (!applicant) return json({ error: 'applicant 파라미터가 필요합니다.' }, 400, cors)

  try {
    // 이름이 흔할수록 헛것이 많이 걸린다. 좁은 표기(주식회사 …)부터 시도한다.
    for (const name of candidates(applicant)) {
      const r = await collect(name, key)
      if (r.error) return json({ error: r.error }, 502, cors)
      if (r.patents.length) {
        return json({ applicant: name, matched: applicant, ...r }, 200, cors)
      }
    }
    return json({ applicant, total: 0, scanned: 0, returned: 0, patents: [], truncated: false }, 200, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

/**
 * 페이징은 docsStart/docsCount 다.
 *
 * numOfRows·pageNo 도 받아 주는 척하지만 실제로는 무시된다 — pageNo 를 1·2·3 으로
 * 바꿔도 같은 30건이 돌아온다. 그걸 모르고 pageNo 로 넘기면 53건짜리 회사가
 * 30건으로 잘린 채 조용히 끝난다. docsStart 는 1부터 세는 레코드 번호다.
 */
const PAGE_SIZE = 30
/** 상류 호출 횟수 상한. 무료 한도가 월 1,000회라 한 회사에 이보다 더 쓰지 않는다. */
const MAX_PAGES = 20

function normName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/주식회사|유한회사|\(주\)|㈜/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function candidates(company) {
  const bare = normName(company)
  return [...new Set([`주식회사 ${bare}`, company, bare])].filter(Boolean)
}

/**
 * 출원인 검색은 정확 일치가 아니라 토큰 검색이다.
 *
 * "알체라" 로 부르면 22,608건이 걸리고 "주식회사 알체라" 로 좁혀도 433건 중 대부분이
 * 알파로보틱스·삼성전자 같은 남의 특허다. 그래서 페이지를 넘기며 받아
 * 출원인명이 정확히 같은 건만 남긴다(공동출원은 '|' 로 이어져 오므로 각각 비교한다).
 */
async function collect(name, key) {
  const want = normName(name)
  const patents = []
  let total = 0
  let scanned = 0
  let page = 1

  for (; page <= MAX_PAGES; page++) {
    const target = new URL(`${KIPRIS}/applicantNameSearchInfo`)
    target.searchParams.set('applicant', name)
    target.searchParams.set('accessKey', key)
    target.searchParams.set('docsStart', String((page - 1) * PAGE_SIZE + 1))
    target.searchParams.set('docsCount', String(PAGE_SIZE))

    const res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT) })
    const text = await res.text()

    const code = /<resultCode>(\d+)/.exec(text)?.[1]
    if (code && code !== '00') {
      const msg = /<resultMsg>([^<]*)/.exec(text)?.[1] || ''
      if (code === '31') {
        return { error: 'KIPRIS 서비스 사용기간이 아닙니다. 「특허·실용 공개·등록공보」 신청 상태를 확인해 주세요. (31)' }
      }
      if (code === '30') return { error: 'KIPRIS 에 등록되지 않은 키입니다. (30)' }
      return { error: `KIPRIS 오류 ${code} ${msg}`.trim() }
    }

    if (page === 1) total = Number(/<TotalSearchCount>(\d+)/.exec(text)?.[1] ?? 0)

    let onPage = 0
    for (const m of text.matchAll(/<PatentUtilityInfo>([\s\S]*?)<\/PatentUtilityInfo>/g)) {
      onPage++
      const c = m[1]
      const owner = pick(c, 'Applicant')
      // 공동출원이면 참여자 중 하나만 같아도 우리 회사 건이다.
      if (!owner.split('|').some((x) => normName(x) === want)) continue
      patents.push({
        applicant: owner,
        title: pick(c, 'InventionName'),
        applicationNumber: pick(c, 'ApplicationNumber'),
        applicationDate: toDate(pick(c, 'ApplicationDate')),
        registrationNumber: pick(c, 'RegistrationNumber') || null,
        registrationDate: toDate(pick(c, 'RegistrationDate')),
        status: pick(c, 'RegistrationStatus') || null,
        // IPC 는 '|' 로 여러 개가 붙어 온다.
        ipc: pick(c, 'InternationalpatentclassificationNumber').split('|').map((s) => s.trim()).filter(Boolean),
        abstract: pick(c, 'Abstract'),
        thumbnail: pick(c, 'ThumbnailPath') || null,
      })
    }
    scanned += onPage
    if (onPage < PAGE_SIZE || scanned >= total) break
  }

  // 같은 출원이 여러 페이지에 걸쳐 오는 경우가 있어 출원번호로 한 번 걸러 준다.
  const seen = new Set()
  const unique = patents.filter((p) => (seen.has(p.applicationNumber) ? false : seen.add(p.applicationNumber)))
  unique.sort((a, b) => String(b.applicationDate || '').localeCompare(String(a.applicationDate || '')))

  return {
    total: unique.length,
    returned: unique.length,
    scanned,
    upstreamHits: total,
    truncated: scanned < total,
    patents: unique,
  }
}
