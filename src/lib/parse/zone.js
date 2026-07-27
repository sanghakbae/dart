// 주석 하나가 차지하는 행 구간만 잘라 낸다.
//
// 문서 전체를 훑으면 같은 라벨이 다른 표에도 나와 엉뚱한 숫자를 물어 온다.
// (「비용의 성격별 분류」의 주식보상비용을 재무상태표의 주석번호 열에서 21 로
//  읽어 온 사고가 있었다. 그 뒤로 표를 읽을 때는 항상 구역을 먼저 자른다.)

/** 다음 주석 제목("15. 퇴직급여") — 여기서 구역이 끝난다. */
const NEXT_NOTE = /^\d{1,2}\s*\.\s*\S/

/**
 * 주석 제목 줄인가.
 *
 * 번호로만 가리면 표 안의 항목 행을 제목으로 착각한다. 재무상태표의
 * "1. 상환전환우선주부채 | 4,5,6 | 6,661,977,055 | …" 이 「상환전환우선주」 주석의
 * 시작으로 잡혀, 주석은 손도 못 대고 부채 행 두 줄만 잘라 온 적이 있다.
 * 제목 줄은 첫 칸에만 글자가 있다.
 */
function isHeading(cells) {
  return cells.slice(1).every((c) => !String(c || '').trim())
}

/**
 * @param {string[][]} rows  셀 배열의 배열
 * @param {RegExp} headRe    구역을 여는 주석 제목
 * @returns {string[][]|null}
 */
export function noteZone(rows, headRe) {
  let start = -1
  for (let i = 0; i < rows.length; i++) {
    const first = (rows[i][0] || '').trim()
    if (start < 0) {
      if (headRe.test(first) && isHeading(rows[i])) start = i
      continue
    }
    // 구역 시작 줄 자체는 건너뛰고, 그 다음부터 새 주석 제목을 찾는다.
    if (i > start + 1 && NEXT_NOTE.test(first) && isHeading(rows[i]) && !headRe.test(first)) {
      return rows.slice(start, i)
    }
  }
  return start >= 0 ? rows.slice(start) : null
}

/** 표 라벨 비교용 — 공백과 괄호 주석(*1) 을 털어 낸다. */
export function normLabel(cell) {
  return String(cell || '')
    .replace(/\s+/g, '')
    .replace(/[(（][^)）]*[)）]/g, '')
    .replace(/[*※]\d*/g, '')
}
