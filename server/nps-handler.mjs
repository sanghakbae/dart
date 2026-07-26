// 국민연금 가입 사업장 내역 프록시.
//
// 감사보고서에는 고용 정보가 없다. 인원·입사·퇴사는 국민연금이 유일한 공개 출처다.
//
//   GET /api/nps/search?name=무하유            사업장 검색 (월별로 행이 하나씩 나온다)
//   GET /api/nps/timeline?name=무하유&months=13  월별 인원·입사·퇴사·고지금액
//
// 주의할 점
//  - 2025-05-07 부터 요청 파라미터가 스네이크 → 카멜 케이스로 바뀌었다(wkpl_nm → wkplNm).
//    옛 표기로 부르면 오류 없이 totalCount 0 만 돌아와 원인을 찾기 어렵다.
//  - seq 는 자료생성년월마다 달라진다. 그래서 시계열을 만들려면 월별 seq 를 먼저 모으고
//    각 월에 상세·기간별 조회를 다시 걸어야 한다.
//  - 공단이 '제공시점 기준 1년치' 만 남기므로 36개월은 받을 수 없다.

const NPS = 'https://apis.data.go.kr/B552015/NpsBplcInfoInqireServiceV2'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

// 국민연금 보험료율 9% — 고지금액에서 기준소득월액을 되돌리는 데 쓴다.
const PREMIUM_RATE = 0.09

export function npsCors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })
}

async function call(op, params, key) {
  const url = new URL(`${NPS}/${op}`)
  url.searchParams.set('serviceKey', key)
  url.searchParams.set('dataType', 'json')
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v)

  const res = await fetch(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`국민연금 API ${res.status}: ${text.slice(0, 120)}`)
  // 인증 실패 등은 JSON 이 아니라 평문("Unauthorized")으로 온다.
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`국민연금 API 응답을 해석할 수 없습니다: ${text.slice(0, 120)}`)
  }
  const head = body?.response?.header
  if (head?.resultCode && head.resultCode !== '00') {
    throw new Error(`국민연금 API 오류 ${head.resultCode}: ${head.resultMsg || ''}`)
  }
  const item = body?.response?.body?.items?.item
  return Array.isArray(item) ? item : item ? [item] : []
}

/** 사업장 검색 — 월별 행에서 최신 월을 대표로 삼고 월별 seq 는 따로 모아 둔다. */
async function searchWorkplaces(name, key) {
  const rows = await call('getBassInfoSearchV2', { wkplNm: name, numOfRows: 100, pageNo: 1 }, key)
  const byPlace = new Map() // 사업장(사업자번호+주소) → { name, months: [{ym, seq}] }
  for (const r of rows) {
    const id = `${r.bzowrRgstNo}|${r.wkplRoadNmDtlAddr || ''}`
    const g = byPlace.get(id) || {
      id,
      name: r.wkplNm,
      bizNo: r.bzowrRgstNo,
      address: r.wkplRoadNmDtlAddr || null,
      status: r.wkplJnngStcd === '1' ? '등록' : '탈퇴',
      months: [],
    }
    if (r.dataCrtYm && r.seq != null) g.months.push({ ym: String(r.dataCrtYm), seq: r.seq })
    byPlace.set(id, g)
  }
  for (const g of byPlace.values()) g.months.sort((a, b) => b.ym.localeCompare(a.ym))
  return [...byPlace.values()].sort((a, b) => (b.months.length || 0) - (a.months.length || 0))
}

/**
 * @param {Request} req
 * @param {string} key data.go.kr 인증키
 * @returns {Promise<Response|null>}
 */
export async function handleNps(req, key) {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/nps/')) return null

  const cors = npsCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!key) return json({ error: 'NPS_API_KEY 가 서버에 설정되지 않았습니다.' }, 500, cors)

  const op = url.pathname.slice('/api/nps/'.length)
  const name = url.searchParams.get('name')

  try {
    if (op === 'search') {
      if (!name) return json({ error: 'name 파라미터가 필요합니다.' }, 400, cors)
      const places = await searchWorkplaces(name, key)
      return json({ total: places.length, places: places.map(({ months, ...rest }) => ({ ...rest, monthCount: months.length })) }, 200, cors)
    }

    if (op === 'timeline') {
      if (!name) return json({ error: 'name 파라미터가 필요합니다.' }, 400, cors)
      const wanted = Math.min(Number(url.searchParams.get('months')) || 13, 24)
      const places = await searchWorkplaces(name, key)
      if (!places.length) return json({ found: false, name, months: [] }, 200, cors)

      // 사업자번호로 특정할 수 있으면 그걸 쓴다(동명 사업장이 흔하다).
      const bizNo6 = (url.searchParams.get('bizNo') || '').replace(/\D/g, '').slice(0, 6)
      const place =
        (bizNo6 && places.find((p) => String(p.bizNo || '').startsWith(bizNo6))) || places[0]

      const targets = place.months.slice(0, wanted)
      // 월마다 상세(인원·고지금액)와 기간별(입·퇴사)을 함께 부른다.
      const months = await Promise.all(
        targets.map(async ({ ym, seq }) => {
          const [detail, flow] = await Promise.all([
            call('getDetailInfoSearchV2', { seq }, key).catch(() => []),
            call('getPdAcctoSttusInfoSearchV2', { seq, dataCrtYm: ym }, key).catch(() => []),
          ])
          const d = detail[0] || {}
          const f = flow[0] || {}
          const headcount = num(d.jnngpCnt)
          const notice = num(d.crrmmNtcAmt)
          return {
            ym: `${ym.slice(0, 4)}-${ym.slice(4, 6)}`,
            headcount,
            joined: num(f.nwAcqzrCnt),
            left: num(f.lssJnngpCnt),
            noticeAmount: notice,
            // 고지금액 = Σ(기준소득월액 × 9%) → 1인 평균 기준소득월액을 되돌린다.
            // 기준소득월액에 상한(2025.7~ 637만원)이 있어 고소득자가 많으면 과소 추정된다.
            avgMonthlyWage: headcount && notice ? Math.round(notice / headcount / PREMIUM_RATE) : null,
          }
        })
      )
      months.sort((a, b) => a.ym.localeCompare(b.ym))

      return json(
        {
          found: true,
          workplace: { name: place.name, bizNo: place.bizNo, address: place.address, status: place.status },
          months,
          note: '국민연금 고지 인원 기준(비정규직 포함). 공단이 1년치만 보관해 그 이전은 조회되지 않습니다.',
        },
        200,
        cors
      )
    }

    return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

function num(v) {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}
