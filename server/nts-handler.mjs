// 국세청 사업자등록정보 상태조회 프록시.
//
//   GET /api/nts/status?bizNo=1208797004
//
// 감사보고서로는 그 회사가 지금도 영업 중인지 알 수 없다. 마지막 보고서가 2년 전이면
// 폐업했는지 공시만 늦은 것인지 구분이 안 된다. 국세청 상태조회가 그걸 바로 답한다.
//
// 주의할 점
//  - 다른 공공데이터와 달리 GET 이 아니라 POST 다. 사업자번호는 본문 JSON 으로 넣고
//    인증키만 쿼리스트링(serviceKey)에 붙인다.
//  - 한 번에 100개까지 받지만 여기서는 한 회사씩만 본다.
//  - 미등록 번호는 오류가 아니라 b_stt 가 빈 문자열로 온다("국세청에 등록되지 않은
//    사업자등록번호"). 오류로 던지면 화면이 장애처럼 보인다 — 상태 없음으로 넘긴다.
//  - 이 서비스는 data.go.kr 에서 따로 활용신청해야 한다. 다른 키를 그대로 쓰면
//    code -4(등록되지 않은 인증키)로 떨어진다.

const NTS = 'https://api.odcloud.kr/api/nts-businessman/v1/status'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const TIMEOUT = 20_000

export function ntsCors(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-max-age': '86400',
  }
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } })

/** 하이픈·공백을 떼고 10자리 숫자만 남긴다. */
export function normalizeBizNo(v) {
  const digits = String(v || '').replace(/\D/g, '')
  return digits.length === 10 ? digits : null
}

/** 123-45-67890 */
export function formatBizNo(v) {
  const d = normalizeBizNo(v)
  return d ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : null
}

const toDate = (s) => {
  const v = String(s || '').replace(/\D/g, '')
  return v.length === 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null
}

/**
 * @param {Request} req
 * @param {string} key data.go.kr 인증키(디코딩된 값)
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

  const bizNo = normalizeBizNo(url.searchParams.get('bizNo'))
  if (!bizNo) return json({ error: 'bizNo(사업자등록번호 10자리)가 필요합니다.' }, 400, cors)

  try {
    return json(await lookup(bizNo, key), 200, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}

/**
 * 국세청 서버는 딸꾹질이 잦다. 같은 번호를 연달아 불러도 한 번은 200, 다음은
 * -5(503) 로 갈린다. 한 번의 실패로 화면에 '조회 실패' 를 띄우면 멀쩡한 회사가
 * 장애로 읽히므로 잠깐 쉬었다 다시 부른다. (국민연금 쪽과 같은 방식)
 */
const RETRY_MS = [600, 1800]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function lookup(bizNo, key, attempt = 0) {
  const target = new URL(NTS)
  target.searchParams.set('serviceKey', key)
  const res = await fetch(target, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ b_no: [bizNo] }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const text = await res.text()

  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`국세청 응답을 해석할 수 없습니다 (${res.status})`)
  }
  // 오류는 { code, msg } 로 온다. code -4 는 이 서비스에 활용신청이 안 된 키다.
  if (body?.code != null && body.code < 0) {
    if (body.code === -4) {
      throw new Error('국세청 상태조회에 신청되지 않은 인증키입니다. data.go.kr 에서 활용신청이 필요합니다. (-4)')
    }
    // -5 는 우리 쪽 문제가 아니다. data.go.kr 게이트웨이는 인증키를 알아보고
    // (모르는 키였다면 -4 가 온다) 국세청 서버로 넘겼는데 그쪽이 응답하지 못한 것이다.
    // 활용신청 승인 직후에도 한동안 이렇게 나온다. 원문 그대로 두면 우리 버그로 읽힌다.
    if (body.code === -5) {
      if (attempt < RETRY_MS.length) {
        await sleep(RETRY_MS[attempt])
        return lookup(bizNo, key, attempt + 1)
      }
      throw new Error(
        '국세청 서버가 응답하지 않습니다. 인증키 문제가 아니라 국세청 쪽 일시 장애이거나 ' +
          '활용신청 승인이 아직 반영되지 않은 상태입니다. 잠시 후 다시 시도해 주세요. (-5)'
      )
    }
    throw new Error(`국세청 오류 ${body.code}: ${body.msg || ''}`.trim())
  }

  const row = Array.isArray(body?.data) ? body.data[0] : null
  // 등록된 적 없는 번호는 b_stt 가 빈 문자열이다. 오류가 아니라 '확인 불가'다.
  const known = Boolean(row && String(row.b_stt || '').trim())

  return {
    bizNo,
    bizNoText: formatBizNo(bizNo),
    known,
    status: known ? row.b_stt : null,            // 계속사업자 · 휴업자 · 폐업자
    statusCode: known ? row.b_stt_cd || null : null, // 01 · 02 · 03
    taxType: row?.tax_type || null,              // 부가가치세 일반과세자 등
    taxTypeCode: row?.tax_type_cd || null,
    taxTypeChangedAt: toDate(row?.tax_type_change_dt),
    closedAt: toDate(row?.end_dt),               // 폐업일
    invoiceApplyAt: toDate(row?.invoice_apply_dt),
    message: known ? null : row?.tax_type || '국세청에 등록되지 않은 사업자등록번호입니다.',
    fetchedAt: Date.now(),
  }
}
