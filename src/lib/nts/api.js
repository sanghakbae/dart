// 국세청 사업자 상태 조회 클라이언트.
//
// 사업자등록번호는 감사보고서 본문에 없다. DART 기업개황(company.json)의 bizr_no 가
// 유일한 출처라, 회사명 → 고유번호 → 사업자번호 → 국세청 순으로 두 번 건너간다.

import { proxyUrl } from '../proxyBase.js'
import { searchCompanies, fetchCompany } from '../dart/api.js'

const norm = (x) => String(x || '').replace(/\s+/g, '')

/** 회사명으로 DART 기업개황을 찾아 사업자등록번호를 얻는다. 이름이 정확히 같은 것만 쓴다. */
export async function findBizNo(companyName) {
  const hits = await searchCompanies(companyName, 40)
  const hit = hits.find((h) => norm(h.name) === norm(companyName))
  if (!hit) throw new Error(`DART 에서 "${companyName}" 와 이름이 정확히 같은 회사를 찾지 못했습니다.`)
  const info = await fetchCompany(hit.code)
  const bizNo = String(info?.bizr_no || '').replace(/\D/g, '')
  if (bizNo.length !== 10) throw new Error('DART 기업개황에 사업자등록번호가 없습니다.')
  return { bizNo, corpCode: hit.code, corpName: info?.corp_name || hit.name }
}

/** 사업자번호 하나의 계속·휴업·폐업 상태 */
export async function fetchBizStatusByNo(bizNo) {
  const res = await fetch(proxyUrl(`/api/nts/status?bizNo=${encodeURIComponent(bizNo)}`))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}

/**
 * 회사명(또는 이미 아는 사업자번호)으로 상태를 받아온다.
 * @param {string} companyName
 * @param {string|null} [knownBizNo] 보고서에서 이미 읽은 사업자번호가 있으면 DART 를 건너뛴다
 */
export async function fetchBizStatus(companyName, knownBizNo = null, onPhase) {
  let bizNo = String(knownBizNo || '').replace(/\D/g, '')
  let corpName = null
  if (bizNo.length !== 10) {
    onPhase?.('사업자번호 확인 중')
    const found = await findBizNo(companyName)
    bizNo = found.bizNo
    corpName = found.corpName
  }
  onPhase?.('국세청 조회 중')
  const status = await fetchBizStatusByNo(bizNo)
  return { ...status, company: companyName, corpName }
}
