// 국세청 사업자등록 상태 프록시 (공공데이터포털 odcloud).
//
//   GET /api/nts/status?bizNo=1234567890
//
// 왜 필요한가 — 감사보고서는 '그 시점' 의 회사만 말해 준다. 보고서가 아무리 멀쩡해도
// 지금 폐업했으면 그게 가장 중요한 사실이다. 이 API 는 사업자번호 하나로
// 계속사업자 · 휴업자 · 폐업자와 폐업일자를 준다.
//
// 주의할 점
//  - 다른 공공데이터포털 API 와 달리 **POST + JSON 본문**이다. serviceKey 는 쿼리로 보낸다.
//  - 인증키는 '디코딩' 키를 넣는다. searchParams 가 한 번 인코딩하므로, 인코딩 키를 넣으면
//    이중 인코딩되어 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 로 떨어진다.
//  - 국세청에 등록되지 않은 번호는 오류가 아니라 tax_type 에 '국세청에 등록되지 않은
//    사업자등록번호입니다.' 가 담겨 온다. 그래서 registered 를 따로 계산해 준다.
//  - 사업자번호는 감사보고서 표지에서 못 읽는 경우가 많다. 그때는 부를 수 없으므로
//    화면에서 안내만 한다(추측해서 부르면 남의 회사 상태를 보여 준다).

const NTS = 'https://api.odcloud.kr/api/nts-businessman/v1/status'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const TIMEOUT = 15_000

export function ntsCors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })

/** 사업자등록번호 10자리. 하이픈·공백은 흘려보낸다. */
export function cleanBizNo(v) {
  const n = String(v || '').replace(/\D/g, '')
  return n.length === 10 ? n : null
}

/** 1234567890 → 123-45-67890 */
export function formatBizNo(v) {
  const n = cleanBizNo(v)
  return n ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : String(v || '')
}

const NOT_REGISTERED = /등록되지\s*않은/

/**
 * 상류 응답 1건 → 화면이 쓰는 모양.
 *
 * b_stt 가 빈 문자열로 오는 경우가 있다(국세청에 없는 번호). 그때 상태를 '계속사업자'
 * 처럼 보이게 두면 안 되므로 registered 로 구분한다.
 */
export function mapStatus(row = {}) {
  const taxType = String(row.tax_type || '').trim()
  const status = String(row.b_stt || '').trim()
  const registered = Boolean(status) && !NOT_REGISTERED.test(taxType)
  return {
    bizNo: cleanBizNo(row.b_no) || String(row.b_no || ''),
    registered,
    // 계속사업자 · 휴업자 · 폐업자. 코드는 01 · 02 · 03.
    status: registered ? status : null,
    statusCode: String(row.b_stt_cd || '').trim() || null,
    // 부가가치세 과세유형(일반·간이·면세). 없는 번호면 안내 문구가 들어오므로 버린다.
    taxType: registered ? taxType || null : null,
    taxTypeChangedAt: toDate(row.tax_type_change_dt),
    closedAt: toDate(row.end_dt),
    // 단위과세 전환 여부·직전 과세유형은 간이과세자에게만 온다.
    unitTaxable: row.utcc_yn === 'Y' ? true : row.utcc_yn === 'N' ? false : null,
    previousTaxType: String(row.rbf_tax_type || '').trim() || null,
  }
}

function toDate(s) {
  const v = String(s || '').replace(/\D/g, '')
  return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null
}

/**
 * @param {Request} req
 * @param {string} key 공공데이터포털 인증키(디코딩)
 * @returns {Promise<Response|null>}
 */
export async function handleNts(req, key) {
  const url = new URL(req.url)
  if (!url.pathname.startsWith('/api/nts/')) return null

  const cors = ntsCors(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (!key) return json({ error: 'NTS_API_KEY 가 서버에 설정되지 않았습니다.' }, 500, cors)

  const op = url.pathname.slice('/api/nts/'.length)
  if (op !== 'status') return json({ error: `알 수 없는 경로: ${op}` }, 404, cors)

  const bizNo = cleanBizNo(url.searchParams.get('bizNo'))
  if (!bizNo) return json({ error: '사업자등록번호 10자리(bizNo)가 필요합니다.' }, 400, cors)

  try {
    const target = new URL(NTS)
    target.searchParams.set('serviceKey', key)
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ b_no: [bizNo] }),
      signal: AbortSignal.timeout(TIMEOUT),
    })
    const text = await res.text()

    let d
    try {
      d = JSON.parse(text)
    } catch {
      // 게이트웨이가 막으면 JSON 이 아닌 HTML·평문이 온다.
      return json({ error: `응답을 해석할 수 없습니다 (${res.status})` }, 502, cors)
    }

    // 키 문제·할당량 초과는 여기로 온다. code/msg 는 게이트웨이 형식이다.
    if (!res.ok || (d.status_code && d.status_code !== 'OK')) {
      const msg = d.msg || d.message || d.status_code || `HTTP ${res.status}`
      return json({ error: `국세청 조회 실패: ${msg}` }, 502, cors)
    }

    const row = Array.isArray(d.data) ? d.data[0] : null
    if (!row) return json({ error: '국세청이 이 번호에 대한 결과를 주지 않았습니다.' }, 502, cors)

    return json(mapStatus(row), 200, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

/**
 * 상태 점검용 1건 호출. 핸들러와 같은 URL·규칙을 쓰려고 여기 둔다
 * (health-handler 에 URL 을 또 적으면 한쪽만 고쳐 놓고 '정상' 을 띄우게 된다).
 *
 * 번호는 공개된 법인 하나를 쓴다(삼성전자). 우리 회사 목록과 무관하게 항상 같은 답이 와야 한다.
 */
export async function probeNts(key) {
  if (!key) return { ok: false, detail: '키가 설정되지 않았습니다 (NTS_API_KEY 또는 NPS_API_KEY)', optional: true }
  const target = new URL(NTS)
  target.searchParams.set('serviceKey', key)
  const res = await fetch(target, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ b_no: ['1248100998'] }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const text = await res.text()
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return { ok: false, detail: `응답을 해석할 수 없습니다 (${res.status})`, optional: true }
  }
  if (res.ok && (!d.status_code || d.status_code === 'OK')) return { ok: true, detail: '정상' }
  return { ok: false, detail: `${d.status_code || res.status} ${d.msg || d.message || ''}`.trim(), optional: true }
}
