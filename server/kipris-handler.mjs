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

import { nameVariants, normName as sharedNorm } from './company-name.mjs'

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

/**
 * 한 번에 받아 보려는 개수.
 *
 * 예전에는 30 이었다. 그건 상류 상한이 아니라 아무것도 지정하지 않았을 때 오는
 * 기본값이었다 — 그 값을 그대로 페이지 크기로 굳혀 두는 바람에 한 회사에 호출을
 * 여러 번 썼다(알체라 433건 = 15회). 무료 한도가 월 1,000회라 이게 곧 비용이다.
 *
 * 상류가 이 개수를 지켜 줄지는 보장이 없다. 그래서 아래 루프는 '요청한 개수' 가
 * 아니라 '실제로 받은 개수' 만큼 다음 시작점을 옮긴다 — 상류가 30 으로 깎아도
 * 목록이 어긋나지 않고, 지켜 주면 호출이 그만큼 줄어든다.
 */
const PAGE_WANT = 500
/** 상류 호출 횟수 상한. 무료 한도가 월 1,000회라 한 회사에 이보다 더 쓰지 않는다. */
const MAX_CALLS = 20

const normName = sharedNorm

/**
 * 찾아볼 출원인명.
 *
 * KIPRIS 에도 등기 상호가 그대로 들어 있어 영문 약칭을 한글 음으로 적는다 —
 * "SK하이닉스" 로는 0건이고 "에스케이하이닉스" 로는 599건이 나온다.
 * 표기 변형마다 '주식회사 ○○' · 원래 이름 · 법인격 없는 이름을 함께 시도한다.
 */
function candidates(company) {
  const out = []
  const seen = new Set()
  for (const v of nameVariants(company)) {
    const bare = normName(v)
    if (!bare || seen.has(bare)) continue
    seen.add(bare)
    // 법인격을 붙인 쪽이 더 좁게 걸린다. 그것부터 시도한다.
    out.push(`주식회사 ${bare}`, bare)
  }
  return out
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
  // 다음에 받을 레코드 번호. 받은 개수만큼만 전진한다(상류가 깎아도 어긋나지 않게).
  let start = 1

  for (let call = 1; call <= MAX_CALLS; call++) {
    const target = new URL(`${KIPRIS}/applicantNameSearchInfo`)
    target.searchParams.set('applicant', name)
    target.searchParams.set('accessKey', key)
    target.searchParams.set('docsStart', String(start))
    target.searchParams.set('docsCount', String(PAGE_WANT))

    const res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT) })
    const text = await res.text()

    const code = /<resultCode>(\d+)/.exec(text)?.[1]
    if (code && code !== '00') {
      const msg = /<resultMsg>([^<]*)/.exec(text)?.[1] || ''
      if (code === '31') {
        return { error: 'KIPRIS 서비스 사용기간이 아닙니다. 「특허·실용 공개·등록공보」 신청 상태를 확인해 주세요. (31)' }
      }
      if (code === '30') return { error: 'KIPRIS 에 등록되지 않은 키입니다. (30)' }
      // 원문 문자열(LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR)만 내보내면
      // 무엇을 해야 하는지 알 수 없다. 한도는 코드로 우회할 수 없으니 그대로 알린다.
      if (code === '22') {
        return { error: 'KIPRIS 호출 한도를 다 썼습니다(무료 계정 월 1,000회). 다음 달에 초기화됩니다. (22)' }
      }
      return { error: `KIPRIS 오류 ${code} ${msg}`.trim() }
    }

    if (call === 1) total = Number(/<TotalSearchCount>(\d+)/.exec(text)?.[1] ?? 0)

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

    // 첫 페이지에 우리 이름이 하나도 없으면 이 표기는 아니다. 다음 후보로 넘긴다.
    //
    // 예전에는 매치가 0건이어도 MAX_PAGES 까지 훑었다. "SK하이닉스" 처럼 표기가
    // 어긋난 이름은 상류에 수만 건이 걸리는데, KIPRIS 한 번 호출이 10초를 넘으니
    // 후보 하나에 몇 분씩 쓰고도 0건으로 끝났다(에스케이하이닉스 599건을 못 찾았다).
    if (call === 1 && !patents.length) break

    // 더 줄 게 없으면 끝. 받은 만큼만 전진하므로 상류가 몇 건을 주든 이어진다.
    if (!onPage || scanned >= total) break
    start += onPage
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
