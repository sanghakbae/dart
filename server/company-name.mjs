// 상호 표기 변형. 국민연금·KIPRIS 가 함께 쓴다.
//
// 두 곳 모두 법인 등기 상호가 그대로 들어 있어 영문 약칭을 한글 음으로 적는다.
// "SK하이닉스" 로 부르면 국민연금은 하청업체 현장만, KIPRIS 는 0건이 나온다.
// 정작 등록된 이름은 "에스케이하이닉스 주식회사" / "주식회사 에스케이하이닉스" 다.

/** 알파벳 한 글자를 한글 음으로. SDS → 에스디에스 처럼 조합해서 만든다. */
const LETTER = {
  A: '에이', B: '비', C: '씨', D: '디', E: '이', F: '에프', G: '지', H: '에이치',
  I: '아이', J: '제이', K: '케이', L: '엘', M: '엠', N: '엔', O: '오', P: '피',
  Q: '큐', R: '알', S: '에스', T: '티', U: '유', V: '브이', W: '더블유', X: '엑스',
  Y: '와이', Z: '지',
}

/** 음이 뭉쳐 조합과 달라지는 것들. 조합보다 이 표를 먼저 쓴다. */
const ALIAS = { LG: '엘지', KT: '케이티', SK: '에스케이', POSCO: '포스코', KCC: '케이씨씨' }

function readLetters(abbr) {
  const up = abbr.toUpperCase()
  if (ALIAS[up]) return ALIAS[up]
  return [...up].map((c) => LETTER[c] || c).join('')
}

/**
 * 찾아볼 이름들. 원래 이름이 언제나 첫 번째다.
 *   SK하이닉스 → [SK하이닉스, 에스케이하이닉스]
 *   삼성SDS    → [삼성SDS, 삼성에스디에스]
 *   LG CNS     → [LG CNS, 엘지 씨엔에스, 엘지씨엔에스]
 */
export function nameVariants(name) {
  const base = String(name || '').trim()
  if (!base) return []
  const out = [base]

  const spelled = base.replace(/[A-Z]{2,6}/g, (m) => readLetters(m))
  if (spelled !== base) out.push(spelled)
  // 바꾼 뒤 남은 공백은 붙여 쓰는 경우가 많다(LG CNS → 엘지씨엔에스)
  const squished = spelled.replace(/\s+/g, '')
  if (squished !== spelled) out.push(squished)

  return [...new Set(out.filter(Boolean))]
}

/** 상호 비교용 — 법인격·공백·기호를 털어 낸다. */
export function normName(s) {
  return String(s || '')
    .normalize('NFC')
    .replace(/주식회사|유한회사|\(주\)|（주）|㈜/g, '')
    .replace(/[^가-힣A-Za-z0-9]/g, '')
    .toLowerCase()
}
