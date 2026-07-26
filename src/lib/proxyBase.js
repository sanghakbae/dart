// 프록시 기준 URL.
//
// 개발 서버는 같은 오리진의 /api/* 를 Vite 플러그인이 받는다.
// 배포본(GitHub Pages)은 정적 호스팅이라 서버가 없으므로, Cloudflare Worker 를 가리켜야 한다.
//   VITE_PROXY_BASE=https://dart-proxy.<계정>.workers.dev
//
// 값이 없으면 같은 오리진으로 호출한다 — 개발 서버에서는 그게 맞고,
// 배포본에서는 404 가 되므로 화면에서 "프록시가 설정되지 않았습니다" 로 안내한다.
const RAW = (import.meta.env.VITE_PROXY_BASE || '').trim().replace(/\/+$/, '')

export const PROXY_BASE = RAW
export const hasProxy = Boolean(RAW) || import.meta.env.DEV

/** `/api/nps/timeline?...` → 배포본에서는 Worker 절대주소 */
export function proxyUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  return RAW ? `${RAW}${p}` : p
}
