// 요청 URL 에서 실제 API 경로를 뽑는다.
//
// 호출 주소에 따라 함수 이름이 경로에 끼거나 빠진다.
//   https://<region>-<project>.cloudfunctions.net/api/api/nps/timeline
//   https://<host>/api/nps/timeline                    (Hosting rewrite)
//   https://<region>-<project>.cloudfunctions.net/api  (health)
// 앞부분을 가정하면 배포 형태가 바뀔 때마다 404 가 난다. 아는 접두사가
// 나오는 지점부터 잘라 쓴다.

const KNOWN = ['/api/nps/', '/api/nts/', '/api/dart/', '/api/kipris/', '/api/health', '/health']

export function apiPathOf(urlish) {
  const raw = String(urlish || '').split('?')[0]
  for (const p of KNOWN) {
    const i = raw.indexOf(p)
    if (i >= 0) return raw.slice(i)
  }
  return raw
}

/** Express 스타일 요청에서 경로와 쿼리를 함께 뽑는다. */
export function apiUrlOf(req) {
  const full = req?.originalUrl || req?.url || ''
  const query = full.split('?')[1]
  return `${apiPathOf(full)}${query ? `?${query}` : ''}`
}
