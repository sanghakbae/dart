// 국민연금 고용 정보 클라이언트. 인증키는 프록시(/api/nps/*)에만 있다.

async function getJson(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}

/**
 * 회사명(+사업자등록번호)으로 월별 고용 시계열을 받는다.
 * 사업자번호를 주면 동명 사업장을 걸러낼 수 있다 — 국민연금은 앞 6자리만 공개한다.
 */
export function fetchEmployment(name, bizNo, months = 13) {
  const q = new URLSearchParams({ name, months: String(months) })
  if (bizNo) q.set('bizNo', bizNo)
  return getJson(`/api/nps/timeline?${q}`)
}

/** 사업연도별 평균 인원 — 인당 매출·인당 인건비 계산에 쓴다. */
export function yearlyAverages(months = []) {
  const byYear = new Map()
  for (const m of months) {
    const y = Number(String(m.ym).slice(0, 4))
    if (!Number.isFinite(y) || m.headcount == null) continue
    const g = byYear.get(y) || { year: y, sum: 0, n: 0, joined: 0, left: 0 }
    g.sum += m.headcount
    g.n += 1
    g.joined += m.joined ?? 0
    g.left += m.left ?? 0
    byYear.set(y, g)
  }
  return [...byYear.values()]
    .map((g) => ({ year: g.year, avgHeadcount: g.sum / g.n, monthCount: g.n, joined: g.joined, left: g.left }))
    .sort((a, b) => a.year - b.year)
}

/**
 * 연간 퇴사율 = 최근 12개월 퇴사자 합 ÷ 같은 기간 평균 인원.
 * (혁신의숲과 같은 산식 — 무하유 25.6% 로 대조 확인했다)
 */
export function turnoverRate(months = []) {
  const last = months.slice(-12)
  if (last.length < 2) return null
  const counts = last.map((m) => m.headcount).filter((v) => v != null)
  if (!counts.length) return null
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length
  const left = last.reduce((a, m) => a + (m.left ?? 0), 0)
  return avg ? { rate: (left / avg) * 100, left, avg, months: last.length } : null
}
