// KIPRIS Plus 프록시 — 특허·실용신안, 상표, 디자인.
//
//   GET /api/kipris/patents?applicant=무하유
//   GET /api/kipris/trademarks?applicant=무하유
//   GET /api/kipris/designs?applicant=무하유
//
// 세 서비스가 같은 구조다(출원인명 검색 → XML → 정확 일치만 남김). 그래서 서비스 표
// 하나만 두고 나머지는 공통 코드로 처리한다.
//
// 주의할 점
//  - 인증 파라미터는 accessKey 다. ServiceKey 로 보내면 30(미등록 키)으로 떨어진다.
//  - 서비스를 신청하지 않으면 키가 있어도 31(사용기간 만료)로 응답한다. 200 으로 오기 때문에
//    화면에서는 '데이터 없음' 처럼 보인다 — 상태 점검(health)에서 이 코드를 구분해 준다.
//    **상표·디자인은 특허와 별개로 신청해야 한다** — 특허 키가 되더라도 이쪽은 31 이 나올 수 있다.
//  - 엔드포인트 철자 'Sevice' 는 KIPRIS 쪽 실제 표기다(오타가 아니다).
//  - 응답이 XML 뿐이라 여기서 JSON 으로 바꿔 넘긴다.
//  - 항목을 감싸는 태그와 필드 이름이 서비스마다 다르고(PatentUtilityInfo · TradeMarkInfo …),
//    같은 뜻인데 표기가 갈리는 것도 있다. 그래서 태그 이름을 하나로 박지 않고
//    후보 목록에서 먼저 걸리는 것을 쓴다 — 상표·디자인 응답을 실제로 확인하기 전까지는
//    이름이 어긋날 수 있어, 하나 틀렸다고 전체가 빈손이 되지 않게 한다.

import { nameVariants, normName as sharedNorm } from './company-name.mjs'

const BASE = 'http://plus.kipris.or.kr/openapi/rest'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
// KIPRIS 는 한 번 부르는 데 10초를 넘기는 일이 잦다(상태 점검도 12.7초 걸렸다).
// 15초로 잡았더니 실제 조회가 전부 타임아웃으로 떨어졌다.
const TIMEOUT = 30_000

/** 페이징 단위. 상류가 docsCount 를 더 크게 줘도 30건까지만 준다. */
const PAGE_SIZE = 30

/**
 * 서비스 표.
 *
 * maxPages 는 한 회사에 쓸 상류 호출 상한이다. 무료 한도가 월 1,000회라
 * 건수가 적은 상표·디자인에는 특허보다 낮게 잡는다.
 *
 * fields 는 후보 태그 목록이다(먼저 값이 있는 것을 쓴다).
 */
const SERVICES = {
  patents: {
    path: 'patUtiModInfoSearchSevice/applicantNameSearchInfo',
    label: '특허·실용신안',
    listKey: 'patents',
    maxPages: 20,
    fields: {
      title: ['InventionName', 'InventionTitle', 'Title'],
      classes: ['InternationalpatentclassificationNumber', 'InternationalPatentClassificationNumber', 'IpcNumber'],
    },
  },
  trademarks: {
    path: 'trademarkInfoSearchService/applicantNameSearchInfo',
    label: '상표',
    listKey: 'trademarks',
    maxPages: 10,
    fields: {
      // 상표명. 국문 표기가 따로 오는 응답도 있다.
      title: ['Title', 'TitleName', 'TitleNameKorean', 'TrademarkName', 'ApplicationName'],
      // 상품분류(니스 분류). '|' 로 여러 개가 붙어 온다.
      classes: ['ClassificationCode', 'ClassificationCodeList', 'ASignProductClassification', 'ProductClassification'],
    },
  },
  designs: {
    path: 'designInfoSearchService/applicantNameSearchInfo',
    label: '디자인',
    listKey: 'designs',
    maxPages: 10,
    fields: {
      // 디자인은 '발명의 명칭' 대신 물품명이다.
      title: ['ArticleName', 'ArticleNameKorean', 'DesignName', 'Title'],
      classes: ['DesignMainClassification', 'DesignClassification', 'ClassificationCode'],
    },
  },
}

/** 어느 서비스에서나 같은 뜻으로 쓰이는 필드. (Appilcant 는 KIPRIS 쪽 실제 오타 표기다) */
const COMMON_FIELDS = {
  applicant: ['Applicant', 'ApplicantName', 'AppilcantName'],
  applicationNumber: ['ApplicationNumber'],
  applicationDate: ['ApplicationDate'],
  registrationNumber: ['RegistrationNumber'],
  registrationDate: ['RegistrationDate'],
  status: ['ApplicationStatus', 'RegistrationStatus'],
  image: ['ThumbnailPath', 'DrawingPath', 'ImagePath', 'BigDrawing'],
  abstract: ['Abstract', 'AbstractContent'],
}

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

/** 후보 태그 중 값이 있는 첫 번째. */
function pickAny(chunk, tags) {
  for (const t of tags) {
    const v = pick(chunk, t)
    if (v) return v
  }
  return ''
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

/** '|' 로 이어 오는 다중값(공동출원인·IPC·상품분류)을 쪼갠다. */
function multi(v) {
  return String(v || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 되풀이되는 항목 블록.
 *
 * 감싸는 태그 이름을 박지 않는다 — 서비스마다 PatentUtilityInfo · TradeMarkInfo · DesignInfo 로
 * 다르고, 확인하지 못한 이름을 박아 두면 응답이 와도 0건으로 읽힌다. 대신 '출원번호를 하나만
 * 담은 가장 안쪽 블록' 을 항목으로 본다. 출원번호가 여러 개인 블록은 목록을 감싼 것이므로
 * 그 안으로 들어간다.
 */
export function itemBlocks(text, depth = 0) {
  const out = []
  for (const m of String(text).matchAll(/<([A-Za-z][\w.-]*)>([\s\S]*?)<\/\1>/g)) {
    const inner = m[2]
    const n = (inner.match(/<ApplicationNumber>/g) || []).length
    if (n === 1) out.push(inner)
    else if (n > 1 && depth < 8) out.push(...itemBlocks(inner, depth + 1))
  }
  return out
}

/** 항목 블록 → 화면이 쓰는 모양. 세 서비스가 같은 모양이라 탭이 표 코드를 나눠 쓴다. */
export function mapItem(chunk, service) {
  const f = { ...COMMON_FIELDS, ...service.fields }
  return {
    applicant: pickAny(chunk, f.applicant),
    title: pickAny(chunk, f.title),
    applicationNumber: pickAny(chunk, f.applicationNumber),
    applicationDate: toDate(pickAny(chunk, f.applicationDate)),
    registrationNumber: pickAny(chunk, f.registrationNumber) || null,
    registrationDate: toDate(pickAny(chunk, f.registrationDate)),
    status: pickAny(chunk, f.status) || null,
    classes: multi(pickAny(chunk, f.classes)),
    abstract: pickAny(chunk, f.abstract),
    thumbnail: pickAny(chunk, f.image) || null,
  }
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
  const service = SERVICES[op]
  if (!service) return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)

  const applicant = url.searchParams.get('applicant')
  if (!applicant) return json({ error: 'applicant 파라미터가 필요합니다.' }, 400, cors)

  try {
    // 이름이 흔할수록 헛것이 많이 걸린다. 좁은 표기(주식회사 …)부터 시도한다.
    for (const name of candidates(applicant)) {
      const r = await collect(name, key, service)
      if (r.error) return json({ error: r.error }, 502, cors)
      if (r.items.length) {
        return json({ applicant: name, matched: applicant, ...shape(r, service) }, 200, cors)
      }
    }
    return json(
      { applicant, total: 0, scanned: 0, returned: 0, [service.listKey]: [], truncated: false },
      200,
      cors
    )
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

/**
 * 목록 키만 서비스마다 다르게 내보낸다(patents · trademarks · designs).
 * 특허 응답 모양은 그대로 둬야 이미 저장된 캐시를 계속 읽을 수 있다.
 */
function shape({ items, ...rest }, service) {
  return { ...rest, [service.listKey]: items }
}

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
 *
 * 페이징은 docsStart/docsCount 다.
 *
 * 특허 서비스는 numOfRows·pageNo 도 받아 주는 척하지만 실제로는 무시한다 — pageNo 를
 * 1·2·3 으로 바꿔도 같은 30건이 돌아온다. 그걸 모르고 pageNo 로 넘기면 53건짜리 회사가
 * 30건으로 잘린 채 조용히 끝난다. 반대로 상표·디자인 쪽이 pageNo 만 볼 수도 있어
 * 둘을 같은 구간으로 맞춰 함께 보낸다(어느 쪽을 봐도 같은 페이지가 온다).
 */
async function collect(name, key, service) {
  const want = normName(name)
  const items = []
  let total = 0
  let scanned = 0

  for (let page = 1; page <= service.maxPages; page++) {
    const target = new URL(`${BASE}/${service.path}`)
    target.searchParams.set('applicant', name)
    target.searchParams.set('accessKey', key)
    target.searchParams.set('docsStart', String((page - 1) * PAGE_SIZE + 1))
    target.searchParams.set('docsCount', String(PAGE_SIZE))
    target.searchParams.set('pageNo', String(page))
    target.searchParams.set('numOfRows', String(PAGE_SIZE))

    const res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT) })
    const text = await res.text()

    const err = upstreamError(text, service)
    if (err) return { error: err }

    if (page === 1) total = Number(/<(?:TotalSearchCount|TotalCount|totalCount)>(\d+)/.exec(text)?.[1] ?? 0)

    let onPage = 0
    for (const chunk of itemBlocks(text)) {
      onPage++
      const it = mapItem(chunk, service)
      // 공동출원이면 참여자 중 하나만 같아도 우리 회사 건이다.
      if (!multi(it.applicant).some((x) => normName(x) === want)) continue
      items.push(it)
    }
    scanned += onPage

    // 첫 페이지에 우리 이름이 하나도 없으면 이 표기는 아니다. 다음 후보로 넘긴다.
    //
    // 예전에는 매치가 0건이어도 maxPages 까지 훑었다. "SK하이닉스" 처럼 표기가
    // 어긋난 이름은 상류에 수만 건이 걸리는데, KIPRIS 한 번 호출이 10초를 넘으니
    // 후보 하나에 몇 분씩 쓰고도 0건으로 끝났다(에스케이하이닉스 599건을 못 찾았다).
    if (page === 1 && !items.length) break

    if (onPage < PAGE_SIZE || scanned >= total) break
  }

  // 같은 출원이 여러 페이지에 걸쳐 오는 경우가 있어 출원번호로 한 번 걸러 준다.
  const seen = new Set()
  const unique = items.filter((p) => (seen.has(p.applicationNumber) ? false : seen.add(p.applicationNumber)))
  unique.sort((a, b) => String(b.applicationDate || '').localeCompare(String(a.applicationDate || '')))

  return {
    total: unique.length,
    returned: unique.length,
    scanned,
    upstreamHits: total,
    truncated: scanned < total,
    items: unique,
  }
}

/** 상류 오류 코드 → 사람이 읽을 문구. 오류가 아니면 null. */
export function upstreamError(text, service) {
  const code = /<resultCode>(\d+)/.exec(text)?.[1]
  if (!code || code === '00') return null
  const msg = /<resultMsg>([^<]*)/.exec(text)?.[1] || ''
  if (code === '31') {
    return `KIPRIS ${service.label} 서비스 사용기간이 아닙니다. 해당 서비스 신청 상태를 확인해 주세요. (31)`
  }
  if (code === '30') return `KIPRIS ${service.label} 서비스에 등록되지 않은 키입니다. (30)`
  return `KIPRIS 오류 ${code} ${msg}`.trim()
}

export { SERVICES }
