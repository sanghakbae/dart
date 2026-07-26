// 계정과목 사전. 회사마다 표기가 달라 동의어를 넓게 잡고, 긴 표기를 먼저 매칭한다.

export const STATEMENTS = {
  BS: { key: 'BS', label: '재무상태표', short: '재무상태표' },
  IS: { key: 'IS', label: '손익계산서', short: '손익' },
  CI: { key: 'CI', label: '포괄손익계산서', short: '포괄손익' },
  CE: { key: 'CE', label: '자본변동표', short: '자본변동' },
  CF: { key: 'CF', label: '현금흐름표', short: '현금흐름' },
}

/** 재무제표 섹션 시작을 알리는 제목 패턴 */
export const SECTION_PATTERNS = [
  { stmt: 'CI', re: /(연결\s*)?포괄\s*손익\s*계산서/ },
  { stmt: 'IS', re: /(연결\s*)?(손익\s*계산서|포괄손익계산서를\s*제외한\s*손익)/ },
  { stmt: 'BS', re: /(연결\s*)?(재무\s*상태표|대차\s*대조표)/ },
  { stmt: 'CE', re: /(연결\s*)?자본\s*변동표/ },
  { stmt: 'CF', re: /(연결\s*)?현금\s*흐름표/ },
]

/**
 * canonical key → { stmt, label, level, synonyms, sign }
 * level 0=합계성 최상위, 1=중분류, 2=세부
 */
export const ACCOUNTS = [
  // ── 재무상태표 ──────────────────────────────────────────────
  { key: 'currentAssets', stmt: 'BS', label: '유동자산', level: 1, syn: ['유동자산'] },
  { key: 'cash', stmt: 'BS', label: '현금및현금성자산', level: 2, syn: ['현금및현금성자산', '현금 및 현금성자산', '현금과예금'] },
  { key: 'shortTermInvest', stmt: 'BS', label: '단기금융상품', level: 2, syn: ['단기금융상품', '단기투자자산'] },
  { key: 'tradeReceivables', stmt: 'BS', label: '매출채권', level: 2, syn: ['매출채권및기타채권', '매출채권 및 기타채권', '매출채권'] },
  { key: 'inventories', stmt: 'BS', label: '재고자산', level: 2, syn: ['재고자산'] },
  { key: 'nonCurrentAssets', stmt: 'BS', label: '비유동자산', level: 1, syn: ['비유동자산', '고정자산'] },
  { key: 'ppe', stmt: 'BS', label: '유형자산', level: 2, syn: ['유형자산'] },
  { key: 'intangibles', stmt: 'BS', label: '무형자산', level: 2, syn: ['무형자산'] },
  { key: 'rightOfUse', stmt: 'BS', label: '사용권자산', level: 2, syn: ['사용권자산'] },
  { key: 'investments', stmt: 'BS', label: '투자자산', level: 2, syn: ['장기금융상품', '투자자산', '관계기업투자'] },
  { key: 'totalAssets', stmt: 'BS', label: '자산총계', level: 0, syn: ['자산총계', '자산 총계', '자산합계'] },

  { key: 'currentLiabilities', stmt: 'BS', label: '유동부채', level: 1, syn: ['유동부채'] },
  { key: 'tradePayables', stmt: 'BS', label: '매입채무', level: 2, syn: ['매입채무및기타채무', '매입채무 및 기타채무', '매입채무'] },
  { key: 'shortTermDebt', stmt: 'BS', label: '단기차입금', level: 2, syn: ['단기차입금'] },
  { key: 'nonCurrentLiabilities', stmt: 'BS', label: '비유동부채', level: 1, syn: ['비유동부채', '고정부채'] },
  { key: 'longTermDebt', stmt: 'BS', label: '장기차입금', level: 2, syn: ['장기차입금', '사채'] },
  { key: 'totalLiabilities', stmt: 'BS', label: '부채총계', level: 0, syn: ['부채총계', '부채 총계', '부채합계'] },

  { key: 'capitalStock', stmt: 'BS', label: '자본금', level: 2, syn: ['자본금'] },
  { key: 'capitalSurplus', stmt: 'BS', label: '자본잉여금', level: 2, syn: ['자본잉여금', '주식발행초과금'] },
  { key: 'retainedEarnings', stmt: 'BS', label: '이익잉여금', level: 2, syn: ['이익잉여금(결손금)', '이익잉여금', '결손금', '미처분이익잉여금'] },
  { key: 'otherEquity', stmt: 'BS', label: '기타자본항목', level: 2, syn: ['기타자본항목', '기타포괄손익누계액', '기타자본구성요소'] },
  { key: 'nonControlling', stmt: 'BS', label: '비지배지분', level: 2, syn: ['비지배지분'] },
  { key: 'totalEquity', stmt: 'BS', label: '자본총계', level: 0, syn: ['자본총계', '자본 총계', '자본합계'] },
  { key: 'totalLiabEquity', stmt: 'BS', label: '부채와자본총계', level: 0, syn: ['부채와자본총계', '부채및자본총계', '부채 및 자본총계', '부채와 자본 총계'] },

  // ── 손익계산서 ──────────────────────────────────────────────
  { key: 'revenue', stmt: 'IS', label: '매출액', level: 0, syn: ['수익(매출액)', '매출액', '영업수익', '매출', '영업수익(매출액)'] },
  { key: 'cogs', stmt: 'IS', label: '매출원가', level: 1, syn: ['매출원가'] },
  // 영업수익/영업비용 구조(서비스업)에서는 매출원가·매출총이익 개념이 없다.
  { key: 'operatingExpense', stmt: 'IS', label: '영업비용', level: 1, syn: ['영업비용'] },
  { key: 'grossProfit', stmt: 'IS', label: '매출총이익', level: 0, syn: ['매출총이익', '매출총이익(손실)', '매출총손실'] },
  { key: 'sgna', stmt: 'IS', label: '판매비와관리비', level: 1, syn: ['판매비와관리비', '판매비 및 관리비', '판매비와 관리비'] },
  { key: 'operatingProfit', stmt: 'IS', label: '영업이익', level: 0, syn: ['영업이익(손실)', '영업이익', '영업손실'] },
  { key: 'otherIncome', stmt: 'IS', label: '기타수익', level: 2, syn: ['기타수익', '영업외수익'] },
  { key: 'otherExpense', stmt: 'IS', label: '기타비용', level: 2, syn: ['기타비용', '영업외비용'] },
  { key: 'financeIncome', stmt: 'IS', label: '금융수익', level: 2, syn: ['금융수익', '이자수익'] },
  { key: 'financeCost', stmt: 'IS', label: '금융원가', level: 2, syn: ['금융원가', '금융비용', '이자비용'] },
  { key: 'pretaxProfit', stmt: 'IS', label: '법인세비용차감전순이익', level: 1, syn: ['법인세비용차감전순이익(손실)', '법인세비용차감전순이익', '법인세비용차감전순손실', '법인세차감전순이익'] },
  { key: 'incomeTax', stmt: 'IS', label: '법인세비용', level: 2, syn: ['법인세비용', '법인세수익'] },
  { key: 'netIncome', stmt: 'IS', label: '당기순이익', level: 0, syn: ['당기순이익(손실)', '분기순이익(손실)', '당기순이익', '당기순손실', '연결당기순이익'] },
  { key: 'eps', stmt: 'IS', label: '기본주당이익', level: 2, syn: ['기본주당순이익(손실)', '기본주당순이익', '기본주당이익(손실)', '기본주당이익', '주당순이익(손실)', '주당순이익', '기본및희석주당순이익', '주당이익(손실)'], perShare: true },
  { key: 'dilutedEps', stmt: 'IS', label: '희석주당이익', level: 2, syn: ['희석주당이익(손실)', '희석주당이익', '희석주당순이익'], perShare: true },

  // ── 포괄손익 ────────────────────────────────────────────────
  { key: 'otherCI', stmt: 'CI', label: '기타포괄손익', level: 1, syn: ['기타포괄손익', '세후기타포괄손익'] },
  { key: 'totalCI', stmt: 'CI', label: '총포괄손익', level: 0, syn: ['총포괄손익', '총포괄이익', '당기총포괄손익', '포괄손익총계'] },

  // ── 현금흐름표 ──────────────────────────────────────────────
  { key: 'cfOperating', stmt: 'CF', label: '영업활동현금흐름', level: 0, syn: ['영업활동현금흐름', '영업활동으로 인한 현금흐름', '영업활동으로인한현금흐름'] },
  { key: 'cfInvesting', stmt: 'CF', label: '투자활동현금흐름', level: 0, syn: ['투자활동현금흐름', '투자활동으로 인한 현금흐름', '투자활동으로인한현금흐름'] },
  { key: 'cfFinancing', stmt: 'CF', label: '재무활동현금흐름', level: 0, syn: ['재무활동현금흐름', '재무활동으로 인한 현금흐름', '재무활동으로인한현금흐름'] },
  { key: 'capex', stmt: 'CF', label: '유형자산의 취득', level: 2, syn: ['유형자산의 취득', '유형자산의취득'] },
  { key: 'cfNetChange', stmt: 'CF', label: '현금의 증가(감소)', level: 1, syn: ['현금및현금성자산의순증가(감소)', '현금및현금성자산의순증가', '현금및현금성자산의 순증가(감소)', '현금및현금성자산의증가(감소)', '현금및현금성자산의증가', '현금및현금성자산의감소', '현금의증가(감소)', '현금의증가', '현금의감소'] },
  { key: 'cfBegin', stmt: 'CF', label: '기초 현금', level: 2, syn: ['기초의현금및현금성자산', '기초 현금및현금성자산', '기초의 현금'] },
  { key: 'cfEnd', stmt: 'CF', label: '기말 현금', level: 2, syn: ['기말의현금및현금성자산', '기말 현금및현금성자산', '기말의 현금'] },
]

export const ACCOUNT_BY_KEY = Object.fromEntries(ACCOUNTS.map((a) => [a.key, a]))

// 동의어를 길이 내림차순으로 펼쳐 둔다: '매출채권및기타채권'이 '매출채권'보다 먼저 걸려야 한다.
const FLAT = ACCOUNTS.flatMap((a) => a.syn.map((s) => ({ ...a, syn: s, norm: normalizeLabel(s) })))
  .sort((x, y) => y.norm.length - x.norm.length)

export function normalizeLabel(s) {
  return String(s || '')
    .replace(/\s+/g, '')
    .replace(/[Ⅰ-Ⅻ]/g, '')
    .replace(/[IVX]{1,4}\./g, '')       // VIII.당기순이익 처럼 로마자를 영문으로 쓴 경우
    .replace(/[·・]/g, '')
    .replace(/^\(\d{1,2}\)/, '')       // (3) 무형자산
    .replace(/^[0-9]+[.)]/, '')
    .replace(/^[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ][.)]?/, '')
    // 로마숫자를 떼고 나면 "Ⅰ. 영업수익" → ".영업수익" 처럼 구두점이 남는다.
    .replace(/^[.)\-–·]+/, '')
    .replace(/^[가-힣][.)]\s*/, (m) => (/^[가-하][.)]/.test(m) ? '' : m))
    .replace(/\(?주\s*\d+(?:[,·]\s*\d+)*\)?/g, '')
    // 주석 참조 열이 라벨로 흘러든 경우: "영업수익23,31,32" → "영업수익"
    .replace(/(?<=[가-힣)\]])[\d,]{1,24}$/, '')
    .trim()
}

/**
 * 표의 라벨 셀을 계정과목에 매칭한다.
 * @param {string} label 원문 라벨
 * @param {string|null} stmtHint 현재 섹션(BS/IS/...)
 */
// K-IFRS 는 손익계산서 항목을 포괄손익계산서 하나에 담는다. 둘을 같은 묶음으로 본다.
const COMPATIBLE = { IS: ['IS', 'CI'], CI: ['CI', 'IS'] }
const fits = (stmt, hint) => !hint || stmt === hint || (COMPATIBLE[hint] || []).includes(stmt)

export function matchAccount(label, stmtHint) {
  const norm = normalizeLabel(label)
  if (!norm || norm.length > 40) return null

  // 1) 현재 섹션(및 호환 섹션) 안에서 완전일치
  for (const c of FLAT) {
    if (c.norm === norm && fits(c.stmt, stmtHint)) return c
  }
  // 2) 섹션 무관 완전일치
  for (const c of FLAT) {
    if (c.norm === norm) return c
  }
  // 3) 접두 포함 매칭 — '영업이익(손실)' 같은 변형 흡수
  for (const c of FLAT) {
    if (norm.length <= 24 && norm.startsWith(c.norm) && fits(c.stmt, stmtHint)) return c
  }
  return null
}
