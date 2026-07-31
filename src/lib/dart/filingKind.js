// 공시 하나가 연간이냐 분기·반기냐.
//
// 서버(server/dart-handler.mjs)도 같은 판정을 해서 kind 를 붙여 보내지만, 프록시가
// 옛 버전이면 그 필드가 안 온다. 그래서 클라이언트도 이름만으로 스스로 가를 수 있어야
// 한다 — 서버·클라이언트 배포가 어긋나도 목록이 뒤섞이지 않게.
//
// 반기·분기를 먼저 걸러야 한다: '반기검토보고서' 에도 '검토보고서' 가 들어 있어
// 순서를 바꾸면 반기가 연간으로 샌다.
export function filingKind(nm = '') {
  if (/분기/.test(nm)) return 'quarter'
  if (/반기/.test(nm)) return 'half'
  if (/(사업보고서|감사보고서)/.test(nm)) return 'annual'
  return 'other'
}

/**
 * 공시 이름에서 누적 키의 앞부분("2025-FY")을 뽑는다.
 *
 * 이미 가져온 공시를 목록에서 잠그는 데 쓴다. 저장된 보고서의 ID 는
 * `연도-기간종류-연결여부`(company.js reportIdOf)이므로, 연결여부를 뺀 앞부분이
 * 같으면 그 기간은 이미 받아 둔 것이다 — 같은 기간을 다시 받으면 덮어쓰기만 한다.
 *
 * 기간종류는 괄호 안의 월로 가른다: (2025.12)=FY · (2025.06)=H1 · (2025.09)=Q3 · (2025.03)=Q1
 * 이름에 '반기'·'분기' 가 있어도 월이 더 정확하다(분기보고서는 3월·9월 둘 다 쓴다).
 *
 * @returns {string|null} 예 "2025-FY"
 */
export function filingPeriodKey(nm = '') {
  const m = /\((\d{4})[.\-/\s]*(\d{1,2})?\)/.exec(String(nm))
  if (!m) return null
  const year = Number(m[1])
  if (!Number.isFinite(year)) return null
  const month = m[2] ? Number(m[2]) : null

  let type
  if (month === 6) type = 'H1'
  else if (month === 9) type = 'Q3'
  else if (month === 3) type = 'Q1'
  else if (month === 12 || month == null) type = 'FY'
  // 12·6·9·3 이 아닌 결산월(예: 3월 결산법인의 사업보고서)은 이름으로 가른다.
  else type = filingKind(nm) === 'annual' ? 'FY' : null

  return type ? `${year}-${type}` : null
}

/**
 * 공시 이름으로 알 수 있는 연결여부 코드('c' · 's'), 모르면 null.
 *
 * 비상장사는 「감사보고서」(별도)와 「연결감사보고서」(연결)를 따로 공시한다. 둘은
 * 다른 문서라 각각 저장되므로(reportIdOf 의 -s · -c), 별도를 받아 뒀다고 연결까지
 * 잠그면 연결을 영영 못 받는다.
 *
 * 사업보고서는 연결과 별도를 한 건에 함께 실어, 어느 쪽으로 저장될지 이름만으로는
 * 알 수 없다 — 그때는 null 을 주고 둘 중 하나라도 있으면 받은 것으로 본다.
 */
export function filingBasisCode(nm = '') {
  const s = String(nm)
  if (/연결/.test(s)) return 'c'
  // 「감사보고서」는 별도 재무제표에 대한 것이다(연결은 이름에 '연결' 이 붙는다).
  if (/감사보고서|검토보고서/.test(s)) return 's'
  return null
}
