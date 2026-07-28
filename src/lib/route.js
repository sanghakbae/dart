// 보고 있던 화면을 주소에 담는다 — `#/co/{회사}/{탭}/{보고서}`
//
// 새로고침하면 회사 목록으로 튕겨 처음부터 다시 찾아 들어가야 했다.
// 주소에 넣어 두면 새로고침해도 그 자리에 남고, 링크로 공유·북마크도 된다.
//
// App.jsx 안에 두면 firebase 까지 끌고 와야 해서 테스트를 붙일 수 없다.
// 순수 함수만 여기 둔다.

const EMPTY = { companyKey: null, tab: null, reportId: null }

/**
 * @param {string} hash    window.location.hash
 * @param {string[]} tabs  쓸 수 있는 탭 키 목록(주소를 손으로 고친 경우를 거른다)
 */
export function readRoute(hash, tabs = []) {
  const m = /^#\/co\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/.exec(hash || '')
  if (!m) return EMPTY

  const companyKey = safeDecode(m[1])
  if (!companyKey) return EMPTY

  const tab = m[2] ? safeDecode(m[2]) : null
  return {
    companyKey,
    // 탭 이름이 바뀐 뒤이거나 주소를 손으로 고쳤을 수 있다.
    tab: tab && tabs.includes(tab) ? tab : null,
    reportId: m[3] ? safeDecode(m[3]) : null,
  }
}

/** 지금 화면을 주소 문자열로. */
export function writeRoute({ companyKey, tab, reportId }) {
  if (!companyKey) return '#/'
  const parts = [encodeURIComponent(companyKey), encodeURIComponent(tab || 'summary')]
  if (reportId) parts.push(encodeURIComponent(reportId))
  return `#/co/${parts.join('/')}`
}

/** decodeURIComponent 는 "%" 하나만 있어도 던진다. 주소는 사용자가 고칠 수 있다. */
function safeDecode(s) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
