// 자본조달 이력. 상장사는 유상증자·CB 발행을 DART 에 공시하므로 그걸 모아 라운드로 만든다.
// 비상장사는 투자 공시 의무가 없어 조회되지 않는다(감사보고서 주석의 RCPS 로만 짐작할 수 있다).
//
// 공시 목록은 가볍지만 원문은 건당 한 번씩 받아야 해서, 최근 것부터 정해진 수만 읽는다.

import { proxyUrl } from '../proxyBase.js'
import { fetchDocumentFile } from './api.js'
import { extractDocument } from '../extract/index.js'
import { parseFunding } from '../parse/funding.js'

/** 원문까지 읽을 최대 건수. 한 건에 왕복 하나라 무한정 늘릴 수 없다. */
const MAX_DETAIL = 24

export async function fetchFundingList(corpCode) {
  const res = await fetch(proxyUrl(`/api/dart/funding?corp=${encodeURIComponent(corpCode)}`))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}

/**
 * 공시 목록 + 원문 파싱 → 라운드 목록.
 * @returns {Promise<{rounds:object[], total:number, parsed:number, truncated:boolean}>}
 */
export async function fetchFundingRounds(corpCode, onProgress) {
  const { list = [], truncated } = await fetchFundingList(corpCode)

  // 정정본이 있으면 원본 대신 그것을 쓴다. 같은 날 같은 종류면 한 건으로 본다.
  const targets = list.slice(0, MAX_DETAIL)
  const rounds = []

  for (let i = 0; i < targets.length; i++) {
    const f = targets[i]
    onProgress?.(`${i + 1}/${targets.length} ${f.reportNm}`)
    try {
      const file = await fetchDocumentFile(f.rceptNo, `${f.reportNm}.html`)
      const doc = await extractDocument(file)
      const parsed = parseFunding(doc)
      if (!parsed) continue
      rounds.push({
        rceptNo: f.rceptNo,
        rceptDt: f.rceptDt,
        reportNm: f.reportNm,
        isAmendment: f.isAmendment,
        kind: parsed.kind,
        totalRaised: parsed.totalRaised ?? null,
        purposes: parsed.purposes || {},
        ...parsed.fields,
      })
    } catch {
      // 한 건이 실패해도 나머지는 보여 준다.
    }
  }

  rounds.sort((a, b) => String(b.rceptDt).localeCompare(String(a.rceptDt)))
  return { rounds: dedupe(rounds), total: list.length, parsed: rounds.length, truncated: Boolean(truncated) }
}

/**
 * 같은 조달 건을 한 줄로 합친다.
 *
 * 한 번의 조달이 공시로는 여러 번 나온다 — 발행결정 → (기재정정) → 증권발행결과.
 * 그대로 두면 누적 조달이 두세 배로 부푼다(알체라 19건 중 실제 조달은 그 절반 이하).
 * 납입일과 종류가 같으면 한 건으로 보고, 정정본·발행결과처럼 나중 것을 남기되
 * 값은 먼저 채워진 쪽을 잃지 않게 병합한다.
 */
function dedupe(rounds) {
  const byKey = new Map()
  for (const r of rounds) {
    // 납입일이 없으면 접수일로 대신한다(합쳐지지 않고 따로 남는다).
    const key = `${r.payDate || r.rceptDt}|${r.kind}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, r)
      continue
    }
    // 최근 접수분을 기준으로 두고, 비어 있는 항목만 옛 공시에서 메운다.
    const [newer, older] = String(r.rceptDt) >= String(prev.rceptDt) ? [r, prev] : [prev, r]
    const merged = { ...older }
    for (const [k, v] of Object.entries(newer)) if (v != null && v !== '') merged[k] = v
    merged.mergedFrom = (prev.mergedFrom || 1) + 1
    byKey.set(key, merged)
  }
  return [...byKey.values()].sort((a, b) => String(b.rceptDt).localeCompare(String(a.rceptDt)))
}

/**
 * 라운드에서 기업가치를 추정한다.
 *
 *   Post-money = 신주 발행가 × (증자 전 발행주식총수 + 신주 수)
 *   Pre-money  = Post-money − 조달금액
 *
 * 시장이 실제로 매긴 값이라 장부·세법 기준보다 현실에 가깝다. 다만
 *  - 제3자배정은 할인율이 붙어 시가보다 낮게 잡힌다(공시에 할인율이 함께 나온다).
 *  - CB·BW 는 전환 전이라 주식수가 늘지 않는다. 전환가로 환산해도 희석 시점이 달라
 *    같은 선에 놓기 어렵다 — 그래서 증자 건만 쓴다.
 */
export function roundValuation(round) {
  if (!round) return null
  const price = num(round.issuePrice)
  const before = num(round.sharesBefore)
  const added = num(round.newShares)
  if (price == null || before == null) return null

  const after = before + (added ?? 0)
  const post = price * after
  const raised = num(round.totalRaised)
  return {
    rceptDt: round.rceptDt,
    kind: round.kind,
    issuePrice: price,
    sharesAfter: after,
    postMoney: post,
    preMoney: raised != null ? post - raised : null,
    raised,
    discount: num(round.discount),
    basePrice: num(round.basePrice),
  }
}

/** 증자 건 중 가장 최근 것으로 기업가치를 잡는다. */
export function latestRoundValuation(rounds = []) {
  for (const r of rounds) {
    if (!/증자/.test(r.kind || '')) continue
    const v = roundValuation(r)
    if (v) return v
  }
  return null
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
