// 국민연금 고용 정보 클라이언트. 인증키는 프록시(/api/nps/*)에만 있다.
// 배포본에서는 같은 오리진에 서버가 없어 Worker 주소로 붙는다(lib/proxyBase.js).

import { proxyUrl } from '../proxyBase.js'

async function getJson(path) {
  const res = await fetch(proxyUrl(path))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}

/**
 * 회사명(+사업자등록번호)으로 월별 고용 시계열을 받는다.
 * 사업자번호를 주면 동명 사업장을 걸러낼 수 있다 — 국민연금은 앞 6자리만 공개한다.
 *
 * 공단이 실제로 주는 건 12개월치다. 그보다 크게 불러도 호출 수는 있는 달만큼만
 * 늘어나므로, 보관 기간이 바뀌면 그만큼 자동으로 더 받게 넉넉히 잡아 둔다.
 * 2·3년 추이는 이렇게 받은 것을 DB 에 쌓아 만든다(storage.saveEmployment).
 */
export function fetchEmployment(name, bizNo, months = 24) {
  const q = new URLSearchParams({ name, months: String(months) })
  if (bizNo) q.set('bizNo', bizNo)
  return getJson(`/api/nps/timeline?${q}`)
}

// 계산은 stats.js 에 있다(네트워크 없이 테스트할 수 있게 분리). 쓰던 곳이 그대로
// 이 모듈에서 가져다 쓰도록 다시 내보낸다.
export { yearlyAverages, turnoverRate, periodSummary } from './stats.js'
