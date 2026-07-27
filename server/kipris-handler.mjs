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
const TIMEOUT = 15_000

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
  const rows = Math.min(Number(url.searchParams.get('rows')) || 100, 500)

  try {
    const target = new URL(`${KIPRIS}/applicantNameSearchInfo`)
    target.searchParams.set('applicant', applicant)
    target.searchParams.set('accessKey', key)
    target.searchParams.set('numOfRows', String(rows))
    target.searchParams.set('pageNo', '1')

    const res = await fetch(target, { signal: AbortSignal.timeout(TIMEOUT) })
    const text = await res.text()

    const code = /<resultCode>(\d+)/.exec(text)?.[1]
    if (code && code !== '00') {
      const msg = /<resultMsg>([^<]*)/.exec(text)?.[1] || ''
      if (code === '31') {
        return json(
          { error: 'KIPRIS 서비스 사용기간이 아닙니다. 「특허·실용 공개·등록공보」 신청 상태를 확인해 주세요. (31)' },
          502,
          cors
        )
      }
      return json({ error: `KIPRIS 오류 ${code} ${msg}`.trim() }, 502, cors)
    }

    const total = Number(/<TotalSearchCount>(\d+)/.exec(text)?.[1] ?? 0)
    const patents = []
    for (const m of text.matchAll(/<PatentUtilityInfo>([\s\S]*?)<\/PatentUtilityInfo>/g)) {
      const c = m[1]
      patents.push({
        applicant: pick(c, 'Applicant'),
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
    patents.sort((a, b) => String(b.applicationDate || '').localeCompare(String(a.applicationDate || '')))

    return json({ applicant, total, returned: patents.length, patents }, 200, cors)
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502, cors)
  }
}
