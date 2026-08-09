// 외부 API 인증키를 DB(Firestore)에서 읽는다.
//
// 왜 DB인가
//   키가 바뀔 때마다 `wrangler secret put` 을 하고 배포까지 해야 했다. 관리자
//   페이지에서 등록하면 바로 반영되도록 저장 위치를 DB 로 옮긴다.
//
// 왜 브라우저가 아니라 여기서 읽는가
//   인증키는 그대로 노출되면 남이 우리 할당량을 쓴다. 그래서 실제 값이 담긴
//   config/apiKeys 문서는 보안 규칙에서 클라이언트 읽기를 완전히 막아 두고
//   (쓰기만 관리자에게 허용), 값을 읽는 것은 서비스 계정을 가진 서버뿐이다.
//   화면에 보여줄 용도로는 마지막 네 자리만 담은 config/apiKeyStatus 를 따로 둔다.
//
// 없으면 어떻게 되는가
//   서비스 계정이 설정돼 있지 않거나 DB 조회가 실패하면 기존 환경 시크릿으로
//   그대로 동작한다. 새 경로가 죽어도 조회 기능은 멈추지 않는다.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/datastore'

/** 키 캐시 수명. 관리자가 바꾼 값이 늦어도 이 시간 안에는 반영된다. */
const KEYS_TTL = 60_000
/** 액세스 토큰은 1시간짜리라 만료 1분 전에 갱신한다. */
const TOKEN_SKEW = 60_000

export const KEY_NAMES = ['DART_API_KEY', 'NPS_API_KEY', 'KIPRIS_API_KEY', 'NTS_API_KEY']

let tokenCache = null // { token, expiresAt }
let keyCache = null // { values, at }

function b64url(bytes) {
  let s = ''
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PEM(PKCS#8) → CryptoKey. 서비스 계정 private_key 는 줄바꿈이 \n 으로 escape 되어 온다. */
async function importKey(pem) {
  const body = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '')
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    raw,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}

/**
 * 서비스 계정으로 액세스 토큰을 받는다.
 * Firebase Admin SDK 를 쓸 수 없는 런타임(Cloudflare Workers)이라 JWT 를 직접 만든다.
 */
async function accessToken(sa) {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt - TOKEN_SKEW > now) return tokenCache.token

  const iat = Math.floor(now / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat,
        exp: iat + 3600,
      })
    )
  )
  const signed = `${header}.${claim}`
  const key = await importKey(sa.private_key)
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signed))

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signed}.${b64url(sig)}`,
    }),
  })
  if (!res.ok) throw new Error(`토큰 발급 실패 (${res.status})`)
  const body = await res.json()
  tokenCache = { token: body.access_token, expiresAt: now + (body.expires_in || 3600) * 1000 }
  return tokenCache.token
}

/** Firestore REST 의 값 표현({stringValue: …})에서 문자열만 꺼낸다. */
function plainStrings(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields || {})) {
    if (typeof v?.stringValue === 'string') out[k] = v.stringValue
  }
  return out
}

/** 서비스 계정 JSON 파싱. 문자열·객체 모두 받는다(시크릿은 문자열로 들어온다). */
export function parseServiceAccount(raw) {
  if (!raw) return null
  try {
    const sa = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!sa?.client_email || !sa?.private_key || !sa?.project_id) return null
    return sa
  } catch {
    return null
  }
}

/**
 * DB에 등록된 인증키를 읽는다. 실패하면 null 을 돌려주고 호출부가 환경값으로 넘어간다.
 * @returns {Promise<Record<string,string>|null>}
 */
export async function fetchStoredKeys(env) {
  const sa = parseServiceAccount(env?.FIREBASE_SERVICE_ACCOUNT)
  if (!sa) return null

  const now = Date.now()
  if (keyCache && now - keyCache.at < KEYS_TTL) return keyCache.values

  try {
    const token = await accessToken(sa)
    const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/config/apiKeys`
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
    // 문서가 아직 없으면 404 다 — 오류가 아니라 '등록된 키 없음'이다.
    if (res.status === 404) {
      keyCache = { values: {}, at: now }
      return keyCache.values
    }
    if (!res.ok) throw new Error(`Firestore ${res.status}`)
    const body = await res.json()
    keyCache = { values: plainStrings(body.fields), at: now }
    return keyCache.values
  } catch {
    // 조회가 안 되면 캐시가 남아 있으면 그걸, 아니면 환경값으로 넘긴다.
    return keyCache?.values || null
  }
}

/**
 * 실제로 쓸 인증키를 정한다. DB 값이 있으면 그것, 없으면 환경 시크릿.
 * @returns {Promise<Record<string,string>>}
 */
export async function resolveKeys(env) {
  const stored = await fetchStoredKeys(env)
  const out = {}
  for (const name of KEY_NAMES) {
    const fromDb = stored?.[name]
    out[name] = (typeof fromDb === 'string' && fromDb.trim()) || env?.[name] || ''
  }
  return out
}

/** 테스트·키 교체 후 캐시를 비운다. */
export function resetKeyCache() {
  keyCache = null
  tokenCache = null
}
