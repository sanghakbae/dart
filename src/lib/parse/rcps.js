// 상환전환우선주(RCPS).
//
// 감사보고서에서 RCPS 는 자본이 아니라 부채로 잡힌다. 그래서 자본금 주석의
// 발행주식수에는 RCPS 주식이 통째로 빠져 있다 — 무하유는 자본금 주석이
// 4,000,000주인데 등기부는 4,685,800주다. 685,800주가 화면 어디에도 없었고,
// 그 수로 나눈 1주당 가치는 14.6% 과대였다.
//
// 게다가 이 주석에는 다른 데서 못 얻는 것들이 있다.
//   - 주당발행가액 → 투자 라운드의 밸류에이션 (비상장사는 DART 공시가 없다)
//   - 상환금액 조항 → 보장 IRR
//   - 상환청구 기간 → 언제부터 투자자가 돈을 빼갈 수 있는지
//   - 전환권조정 상각 → 현금이 안 나가는데 순이익을 깎는 이자비용
//
// 주석 번호는 문서마다 다르다(무하유 연결 14, 별도 15). 제목으로 찾는다.

import { parseAmount } from './numbers.js'
import { noteZone, normLabel, isHeading } from './zone.js'

// 제목 전체가 이것이어야 한다. 끝을 열어 두면 재무상태표의
// 「상환전환우선주부채」 항목 행까지 제목으로 걸린다.
const HEAD = /^\d{1,2}\s*\.\s*(상환전환우선주|전환상환우선주)(식|부채)?\s*$/

/** (1) 부채 내역 표 — 당기말·전기말·전기초 순으로 실린다. */
const LIABILITY = [
  [/^(상환전환우선주|전환상환우선주)$/, 'face', '상환전환우선주'],
  [/^상환할증금$/, 'premium', '상환할증금'],
  [/^전환권조정$/, 'conversionAdj', '전환권조정'],
  [/^소계$/, 'carrying', '소계'],
  [/^차감[:：]?유동성대체$/, 'currentTransfer', '유동성대체'],
]

/** (2) 세부내역 표 — 한 행이 한 조건이고, 열이 종류(제1종·제2종)다. */
const DETAIL = [
  [/^대상자/, 'investors'],
  [/^주당발행가액/, 'issuePrice'],
  [/^발행주식수/, 'shares'],
  [/^발행일/, 'issueDate'],
  [/^의결권/, 'voting'],
  [/^존속기간/, 'term'],
  [/^배당/, 'dividend'],
  [/^전환청구자/, 'conversionClaimant'],
  [/^전환비율$/, 'conversionRatio'],
  [/^전환비율의조정/, 'refixing'],
  [/^전환청구기간/, 'conversionPeriod'],
  [/^상환청구권보유자/, 'putHolder'],
  [/^상환청구기간/, 'putPeriod'],
  [/^상환금액/, 'redemption'],
]

/**
 * @param {{rows: {cells:string[]}[]}} doc
 * @returns {null|object}
 */
export function parseRcps(doc) {
  const rows = (doc?.rows || []).map((r) => (r.cells || []).map((c) => String(c).trim()))
  const zone = noteZone(rows, HEAD) || detailZone(rows)
  if (!zone) return null

  const liability = readLiability(zone)
  const series = readSeries(zone)
  const accretion = readAccretion(zone)
  const derivative = readDerivative(zone)
  const pnl = readPnl(zone)

  // 표를 하나도 못 읽었으면 이 주석이 아니거나 서식이 다른 것이다.
  if (!series.length && !liability) return null

  const detailed = series.map(withTerms)
  const totalShares = sumOf(detailed, 'shares')

  return {
    found: true,
    series: detailed,
    shares: totalShares,
    liability,
    accretion,
    derivative,
    pnl,
    // 이 회사 몫으로 잡힌 RCPS 관련 부채 전부. 부채요소만 보면 절반도 안 보인다
    // (무하유는 부채요소 66.6억 + 파생상품 101.8억 = 168.4억이고 자본총계가 108.5억이다).
    totalLiability: sumNullable([liability?.carrying, derivative?.current]),
    ...summarize(detailed, liability),
    ...readSplitAdjustment(zone, totalShares),
  }
}

/**
 * 주당발행가액이 '환산가' 인지 밝힌다.
 *
 * 무상증자·액면분할을 하면 회사는 주석의 발행가를 분할 후 기준으로 고쳐 적는다.
 * 무하유 2025년 주석의 17,500원이 그것이고, 투자자가 2023년에 실제로 낸 돈은
 * 주당 350만원이다. 그런데 화면에는 "주당발행가액 17,500원" 으로만 나와,
 * 투자자가 그 값에 샀다고 읽히는 문제가 있었다.
 *
 * 각주에 "N주에서 M주로 증가" 가 적히므로 배수를 되짚어 당시 단가를 복원한다.
 *   3,429주 → 68,580주 → 685,800주  = 200배,  17,500 × 200 = 350만원
 */
function readSplitAdjustment(zone, totalShares) {
  // 키가 늘 같아야 한다. 빠뜨리면 undefined 가 섞여 Firestore 저장에서 사라진다.
  const none = { splitAdjusted: false, originalShares: null, splitRatio: null }

  const notes = zone
    .filter((cells) => /무상증자|액면\s*분할/.test(cells.join(' ')))
    .map((cells) => cells.join(' '))
    .join(' ')
  if (!notes) return none

  // 발행가가 조정된 값이라고 각주가 밝히는 경우에만 '환산가' 로 본다.
  const adjusted = /조정된[^.]{0,20}주당발행가액|주당발행가액입니다/.test(notes)

  // "3,429주에서 68,580주로 증가" 들을 모아 최초 주식수를 찾는다.
  const steps = [...notes.matchAll(/([\d,]+)\s*주에서\s*([\d,]+)\s*주로/g)].map((m) => [
    parseAmount(m[1]),
    parseAmount(m[2]),
  ])
  const froms = steps.map(([a]) => a).filter((v) => v != null)
  const originalShares = froms.length ? Math.min(...froms) : null
  const ratio =
    originalShares && totalShares && originalShares > 0 ? Math.round(totalShares / originalShares) : null

  const splitRatio = ratio && ratio > 1 ? ratio : null
  if (!adjusted && !splitRatio) return none
  return { splitAdjusted: true, originalShares: originalShares ?? null, splitRatio }
}

/**
 * 독립 주석이 없는 서식을 위한 구역 찾기.
 *
 * 일반기업회계기준(K-GAAP) 보고서는 상환전환우선주를 따로 떼지 않고 자본금 주석
 * 아래 "(4) 당기말 현재 전환상환우선주의 세부내역은 다음과 같습니다." 로 붙인다.
 * 그러면 "N. 상환전환우선주" 제목이 없어 noteZone 이 못 찾는다 — 무하유 2024년이
 * 그래서 통째로 안 잡혔다(120억 투자가 화면에서 사라졌다).
 *
 * 세부내역을 여는 문장을 찾아 그 아래 표만 잘라 온다.
 */
const DETAIL_OPENER = /(전환상환우선주|상환전환우선주).{0,20}세부내역/

function detailZone(rows) {
  const start = rows.findIndex((cells) => DETAIL_OPENER.test((cells[0] || '').replace(/\s+/g, '')))
  if (start < 0) return null

  // 표가 끝나는 곳까지 — 다음 주석 제목이 나오면 멈춘다.
  // 제목 줄만 인정한다. 번호로만 가리면 표 안의 항목 행("1. 상환전환우선주부채 | …")
  // 에서 구역이 잘려 표를 반토막 낸다.
  const NEXT = /^\d{1,2}\s*\.\s*\S/
  let end = rows.length
  for (let i = start + 1; i < rows.length; i++) {
    if (NEXT.test((rows[i][0] || '').trim()) && isHeading(rows[i])) {
      end = i
      break
    }
  }
  return rows.slice(start, end)
}

/** (1) 부채 내역. 열은 당기말·전기말·전기초 순이다. */
function readLiability(zone) {
  const out = {}
  const prior = {}
  for (const cells of zone) {
    if (cells.length < 2) continue
    const label = normLabel(cells[0])
    const hit = LIABILITY.find(([re]) => re.test(label))
    if (!hit || out[hit[1]] != null) continue
    const nums = cells.slice(1).map(parseAmount).filter((v) => v != null)
    if (!nums.length) continue
    out[hit[1]] = nums[0]
    if (nums[1] != null) prior[hit[1]] = nums[1]
  }
  if (!Object.keys(out).length) return null
  // 전액 유동성대체 = 1년 안에 상환청구가 열려 있다는 뜻이다. 위험 신호로 쓴다.
  out.allCurrent = out.currentTransfer != null && out.carrying != null
    && Math.abs(Math.abs(out.currentTransfer) - out.carrying) < 1
  out.prior = Object.keys(prior).length ? prior : null
  return out
}

/**
 * (2) 세부내역. 열 하나가 종류주식 하나다.
 * 표 머리("구 분 | 제1종 상환전환우선주")에서 종류 이름을 먼저 잡는다.
 */
function readSeries(zone) {
  let names = null
  const byKey = new Map()

  for (const cells of zone) {
    if (cells.length < 2) continue
    const label = normLabel(cells[0])

    if (!names && /^구분$/.test(label) && /우선주/.test(cells.slice(1).join(' '))) {
      names = cells.slice(1).map((c) => c.trim()).filter(Boolean)
      continue
    }
    const hit = DETAIL.find(([re]) => re.test(label))
    if (!hit || byKey.has(hit[1])) continue
    byKey.set(hit[1], cells.slice(1))
  }
  if (!byKey.size) return []

  const width = Math.max(names?.length || 0, ...[...byKey.values()].map((v) => v.length))
  const out = []
  for (let i = 0; i < width; i++) {
    const pick = (k) => byKey.get(k)?.[i] ?? null
    const raw = Object.fromEntries([...byKey.keys()].map((k) => [k, pick(k)]))
    out.push({
      name: names?.[i] || `제${i + 1}종 상환전환우선주`,
      ...raw,
      issuePrice: readMoney(raw.issuePrice),
      shares: parseAmount(String(raw.shares || '').replace(/주/g, '')),
      issueDate: readDate(raw.issueDate),
    })
  }
  // 값이 하나도 없는 열(빈 칸)은 종류가 아니다.
  return out.filter((s) => s.shares != null || s.issuePrice != null || s.issueDate)
}

/** (3) 변동내역 — 상각액이 곧 당기 이자비용이다. 현금은 나가지 않는다. */
function readAccretion(zone) {
  for (const cells of zone) {
    if (cells.length < 2) continue
    if (!/^상각$/.test(normLabel(cells[0]))) continue
    const nums = cells.slice(1).map(parseAmount).filter((v) => v != null)
    if (!nums.length) continue
    return { current: nums[0], prior: nums[1] ?? null }
  }
  return null
}

/**
 * (4) 전환권·조기상환권 파생상품부채. 부채요소와 따로 잡히는데 대개 이쪽이 더 크다.
 *
 * 같은 주석 본문에도 이 말이 나온다 — "전환권 및 조기상환권은 파생상품부채로
 * 계상되어 있습니다". 그 문장에 걸리는 바람에 101억을 통째로 놓쳤다.
 * 표의 라벨 칸은 그 말로 끝나고 짧다. 숫자를 못 찾으면 다음 후보로 넘어간다.
 */
function readDerivative(zone) {
  for (let i = 0; i < zone.length; i++) {
    const label = normLabel(zone[i][0])
    if (label.length > 30 || !/파생상품부채$/.test(label)) continue
    // 라벨 행 자체가 비어 있고 바로 아래 행에 금액이 오는 서식이 흔하다.
    for (let j = i; j < Math.min(i + 4, zone.length); j++) {
      const nums = zone[j].slice(1).map(parseAmount).filter((v) => v != null)
      if (nums.length) return { current: nums[0], prior: nums[1] ?? null, initial: nums[3] ?? null }
    }
  }
  return null
}

/**
 * (5) RCPS 관련 손익.
 *
 * 파생상품 평가손익은 회사가 장사를 잘했는지와 무관하게 순이익을 흔든다
 * (무하유는 당기 9.9억 손실). 회사가 그걸 뺀 이익을 직접 밝히는 경우가 많아
 * 그대로 가져다 쓴다 — 우리가 임의로 조정하는 것보다 낫다.
 */
function readPnl(zone) {
  const out = {}
  for (const cells of zone) {
    if (cells.length < 2) continue
    const label = normLabel(cells[0])
    const key = /^파생금융상품평가(손실|이익|손익)$/.test(label)
      ? 'derivativeLoss'
      : /^파생금융상품평가손익제외/.test(label)
        ? 'pretaxExDerivative'
        : /^법인세비용차감전순이익/.test(label)
          ? 'pretax'
          : null
    if (!key || out[key] != null) continue
    const nums = cells.slice(1).map(parseAmount).filter((v) => v != null)
    if (nums.length) out[key] = nums[0]
  }
  return out.pretaxExDerivative != null || out.derivativeLoss != null ? out : null
}

/** 종류주식 하나의 조항 문장에서 기간·이율을 뽑아 붙인다. */
function withTerms(s) {
  const termYears = firstNumber(s.term, /(\d+(?:\.\d+)?)\s*년/)
  const putAfterYears = firstNumber(s.putPeriod, /(\d+(?:\.\d+)?)\s*년이?\s*경과/)
  return {
    ...s,
    termYears,
    putAfterYears,
    maturityDate: addYears(s.issueDate, termYears),
    putStartDate: addYears(s.issueDate, putAfterYears),
    statedRate:
      firstNumber(s.redemption, /연\s*복리\s*([\d.]+)\s*%/) ?? firstNumber(s.redemption, /연\s*([\d.]+)\s*%/),
  }
}

/**
 * 여러 종류를 하나로 요약한다.
 *
 * 제1종·제2종을 각각 다른 가격에 발행하는 일이 흔하다. 그때 첫 번째 종류의 가격을
 * 대표로 쓰면 기업가치가 통째로 틀어진다 — 조달금액은 종류별로 곱해 더하고,
 * 대표 단가는 '가장 최근 라운드' 것을 쓴다(그게 그 시점의 밸류를 말한다).
 * 반대로 위험은 '가장 먼저 열리는' 상환청구가 정하므로 그쪽은 최솟값을 쓴다.
 *
 * 보장수익률은 두 곳에서 나온다 — 상환금액 조항의 "연복리 7%" 와,
 * 상환할증금을 원금으로 역산한 값. 둘을 맞춰 보면 어느 쪽 해석이 맞는지 알 수 있다.
 */
function summarize(series, liability) {
  const byDateDesc = [...series].sort((a, b) =>
    String(b.issueDate || '').localeCompare(String(a.issueDate || ''))
  )
  const latest = byDateDesc[0] || {}

  const prices = [...new Set(series.map((s) => s.issuePrice).filter((v) => v != null))]
  const priced = series.filter((s) => s.issuePrice != null && s.shares != null)
  const raised =
    liability?.face ??
    (priced.length ? priced.reduce((a, s) => a + s.issuePrice * s.shares, 0) : null)

  const face = liability?.face ?? null
  const premium = liability?.premium ?? null
  // (원금+할증금 ÷ 원금)^(1/존속기간) − 1.
  // 부채 표는 종류를 합친 금액이라, 종류가 둘 이상이면 역산이 성립하지 않는다.
  const single = series.length <= 1
  const impliedRate =
    single && face && premium && latest.termYears
      ? (((face + premium) / face) ** (1 / latest.termYears) - 1) * 100
      : null

  const putDates = series.map((s) => s.putStartDate).filter(Boolean).sort()

  return {
    issueDate: latest.issueDate || null,
    issuePrice: latest.issuePrice ?? null,
    // 종류마다 단가가 다르면 대표 단가 하나로 기업가치를 매길 수 없다. 화면에서 밝힌다.
    mixedPrices: prices.length > 1,
    raised,
    // 종류마다 보장이율이 다르면 합친 원금에 한 이율을 곱할 수 없다.
    uniformRate: new Set(series.map((s) => s.statedRate).filter((v) => v != null)).size <= 1,
    termYears: latest.termYears ?? null,
    maturityDate: latest.maturityDate || null,
    putAfterYears: latest.putAfterYears ?? null,
    putStartDate: putDates[0] || null,
    statedRate: latest.statedRate ?? null,
    impliedRate: impliedRate != null ? Math.round(impliedRate * 100) / 100 : null,
    // 발행 당시 실제 단가. 주석의 발행가가 분할 후로 환산돼 있으면 화면에 둘 다 낸다.
    // (readSplitAdjustment 가 배수를 채우면 parseRcps 가 여기에 얹는다)
    // 배당 0% 라도 상환할증금이 수익률을 대신하는 구조가 흔하다. 둘을 같이 봐야 한다.
    dividend: latest.dividend || null,
    refixing: latest.refixing || null,
    conversionRatio: latest.conversionRatio || null,
    putPeriod: latest.putPeriod || null,
    redemption: latest.redemption || null,
  }
}

/**
 * 상환청구가 열리는 시점의 상환금액 = 원금 × (1+r)^경과연수.
 * 부채 표의 원금은 종류를 합친 값이라, 종류마다 이율이 다르면 계산이 성립하지 않는다.
 */
export function redemptionAt(rcps, years) {
  const face = rcps?.liability?.face
  const rate = rcps?.statedRate ?? rcps?.impliedRate
  if (!face || !rate || !years || rcps?.uniformRate === false) return null
  return Math.round(face * (1 + rate / 100) ** years)
}

/**
 * 금액 칸. 단위가 숫자에 붙어 오는 경우가 있다 — "3,500천원" (= 350만원).
 * 그냥 '원'만 떼면 "3,500천" 이 남아 파싱에 실패하고, 발행가가 통째로 비었다
 * (무하유 2024년: 주당 350만원을 못 읽었다).
 */
function readMoney(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  // 긴 단위부터 봐야 한다. '백만' 을 한 글자씩 지우면 "3,500백" 이 남아 파싱에 실패한다.
  const UNITS = [
    [/(\d)\s*조\s*원?/, 1e12],
    [/(\d)\s*억\s*원?/, 1e8],
    [/(\d)\s*백만\s*원?/, 1e6],
    [/(\d)\s*만\s*원?/, 1e4],
    [/(\d)\s*천\s*원?/, 1e3],
  ]
  const hit = UNITS.find(([re]) => re.test(s))
  const scale = hit ? hit[1] : 1
  const n = parseAmount(s.replace(/\s*(조|억|백만|만|천)?\s*원/g, '').replace(/\s*(조|억|백만|만|천)\s*$/, ''))
  return n == null ? null : n * scale
}

function readDate(raw) {
  const s = String(raw || '')
  const m = /(\d{4})\s*[-.년/]\s*(\d{1,2})\s*[-.월/]\s*(\d{1,2})/.exec(s)
  if (!m) return null
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
}

function addYears(date, years) {
  if (!date || !years) return null
  const [y, m, d] = date.split('-').map(Number)
  return `${y + Math.round(years)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function firstNumber(text, re) {
  const m = re.exec(String(text || ''))
  return m ? Number(m[1]) : null
}

function sumOf(list, key) {
  const nums = list.map((x) => x[key]).filter((v) => v != null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null
}

function sumNullable(list) {
  const nums = list.filter((v) => v != null)
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null
}
