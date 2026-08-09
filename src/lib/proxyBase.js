// 프록시 기준 URL.
//
// 개발 서버는 같은 오리진의 /api/* 를 Vite 플러그인이 받는다.
// 배포본(GitHub Pages)은 정적 호스팅이라 서버가 없으므로, Cloudflare Worker 를 가리켜야 한다.
//   VITE_PROXY_BASE=https://dart-proxy.<계정>.workers.dev
//
// 값이 없으면 같은 오리진으로 호출한다 — 개발 서버에서는 그게 맞고,
// 배포본에서는 404 가 되므로 화면에서 "프록시가 설정되지 않았습니다" 로 안내한다.
const RAW = (import.meta.env.VITE_PROXY_BASE || '').trim().replace(/\/+$/, '')

/**
 * 국민연금 전용 출구.
 *
 * data.go.kr 은 Cloudflare Worker 에서 오는 요청을 즉시 거절한다 — 같은 Worker 에서
 * opendart 는 200(0.5초)인데 apis.data.go.kr 은 8회 연속 실패했고, 브라우저 헤더·
 * 재시도·Smart Placement 어느 것도 통하지 않았다. 출구 IP 문제라 코드로 못 푼다.
 * 그래서 국민연금만 구글 IP 로 나가는 Firebase Functions 를 거친다.
 *   VITE_NPS_BASE=https://asia-northeast3-<프로젝트>.cloudfunctions.net/api
 *
 * 값이 없으면 기존 프록시를 그대로 쓴다 — 개발 서버에서는 그게 맞다.
 */
const NPS_RAW = (import.meta.env.VITE_NPS_BASE || '').trim().replace(/\/+$/, '')

/** 이 접두사로 시작하는 경로만 국민연금 출구로 보낸다. DART·KIPRIS 는 그대로 둔다. */
const NPS_PATHS = ['/api/nps/']

export const PROXY_BASE = RAW
export const NPS_BASE = NPS_RAW
export const hasProxy = Boolean(RAW) || import.meta.env.DEV

/** `/api/nps/timeline?...` → 배포본에서는 Worker(또는 국민연금 출구) 절대주소 */
export function proxyUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`
  const base = NPS_RAW && NPS_PATHS.some((x) => p.startsWith(x)) ? NPS_RAW : RAW
  return base ? `${base}${p}` : p
}
