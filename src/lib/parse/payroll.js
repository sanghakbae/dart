// 인건비. 「비용의 성격별 분류」 주석에 종업원급여가 총액으로 실린다.
//
//   25. 비용의 성격별 분류
//   구 분        당기            전기
//   종업원급여   6,661,227,265   7,306,901,198
//   주식보상비용   300,909,576     180,907,185
//   복리후생비     486,541,111     609,098,175
//
// 국민연금에서 받은 인원으로 나누면 1인당 인건비가 나온다. 국민연금 고지금액으로
// 역산한 평균보수는 기준소득월액 상한(2025.7~ 637만원)에 걸려 과소 추정되므로,
// 이쪽이 실제 인건비에 더 가깝다.

import { parseAmount } from './numbers.js'

const ITEMS = [
  [/^종업원급여$/, 'employeeBenefits', '종업원급여'],
  [/^(급여|급여및임금|임금)$/, 'wages', '급여'],
  [/^주식보상비용$/, 'shareBasedPay', '주식보상비용'],
  [/^복리후생비$/, 'welfare', '복리후생비'],
  [/^퇴직급여$/, 'retirement', '퇴직급여'],
]

const ZONE_HEAD = /^\d{1,2}\s*\.\s*(비용의\s*성격별\s*분류|판매비와\s*관리비|종업원급여)/
// 다음 주석 제목("26. 금융수익" 등)이 나오면 구역이 끝난다.
const NEXT_NOTE = /^\d{1,2}\s*\.\s*\S/

/** 인건비 항목이 모여 있는 주석 구역의 행만 잘라 낸다. */
function costZone(rows) {
  let start = -1
  for (let i = 0; i < rows.length; i++) {
    const first = (rows[i][0] || '').trim()
    if (start < 0) {
      if (ZONE_HEAD.test(first)) start = i
      continue
    }
    // 구역 시작 줄 자체는 건너뛰고, 그 다음부터 새 주석 제목을 찾는다.
    if (i > start + 1 && NEXT_NOTE.test(first) && !ZONE_HEAD.test(first)) {
      return rows.slice(start, i)
    }
  }
  return start >= 0 ? rows.slice(start) : null
}

/**
 * @returns {null | {values:object, total:{current:number|null, prior:number|null}, source:string}}
 */
export function parsePayroll(doc) {
  const rows = doc.rows.map((r) => (r.cells || []).map((c) => String(c).trim()))

  // 「비용의 성격별 분류」 구역 안에서만 읽는다.
  // 문서 전체를 훑으면 같은 라벨이 다른 주석 표에도 나와 엉뚱한 숫자를 물어 온다
  // (주식보상비용을 주석 번호 '21' 로 읽는 사고가 있었다).
  const zone = costZone(rows) || rows

  const found = {}
  for (const cells of zone) {
    if (cells.length < 2) continue
    const label = cells[0].replace(/\s+/g, '').replace(/[(（][^)）]*[)）]/g, '')
    const hit = ITEMS.find(([re]) => re.test(label))
    if (!hit) continue
    const nums = cells.slice(1).map(parseAmount).filter((v) => v != null)
    if (!nums.length) continue
    if (found[hit[1]]) continue
    found[hit[1]] = { label: hit[2], current: nums[0], prior: nums[1] ?? null }
  }
  if (!Object.keys(found).length) return null

  // 총 인건비 = 종업원급여(없으면 급여) + 주식보상 + 복리후생 + 퇴직급여.
  // 종업원급여가 이미 퇴직급여를 품는 경우가 있어 둘이 함께 있으면 종업원급여만 쓴다.
  const base = found.employeeBenefits || found.wages
  const add = ['shareBasedPay', 'welfare']
  if (!found.employeeBenefits && found.retirement) add.push('retirement')

  const sum = (which) => {
    if (!base || base[which] == null) return null
    return add.reduce((acc, k) => acc + (found[k]?.[which] ?? 0), base[which])
  }

  return {
    values: found,
    total: { current: sum('current'), prior: sum('prior') },
    source: found.employeeBenefits ? '종업원급여' : '급여',
  }
}
