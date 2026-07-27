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
