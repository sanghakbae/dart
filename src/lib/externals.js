// 외부 조회(고용·투자·특허·상표·디자인·사업자상태·조달실적) 한 곳.
//
// 탭마다 제 나름의 조회 함수를 두었더니, 새 회사 등록 때 미리 받아 두는 코드와
// 갈라질 위험이 생겼다. 조회는 여기 하나만 두고 탭도 등록 훅도 같은 것을 쓴다.
//
// 대부분 상류 호출이 무겁다 — 국민연금은 한 회사에 13회 안팎에 10초쯤 걸리고,
// KIPRIS 는 무료 한도가 월 1,000회(특허·상표·디자인이 나눠 쓴다), DART 자본조달은 공시마다
// 원문을 한 번씩 받고, 조달청은 조회 기간이 1개월 제한이라 개월 수만큼 부른다.
// 그래서 탭을 열 때마다 받지 않고, 받은 것은 DB 에 넣어 두고 쓴다.
// (예외는 국세청 사업자상태 하나 — 한 회사에 1회로 끝난다)

import { fetchEmployment } from './nps/api.js'
import { fetchFundingRounds } from './dart/funding.js'
import { searchCompanies } from './dart/api.js'
import { proxyUrl, hasProxy } from './proxyBase.js'
import { saveEmployment, saveFunding, savePatents, saveBizStatus } from './storage.js'

/** 프록시 GET 한 번. 오류 본문의 error 를 그대로 사용자에게 보여 준다. */
async function get(path) {
  const res = await fetch(proxyUrl(path))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}

/**
 * 특허·상표·디자인. 이름 변형(주식회사 유무)과 정확 일치 판정은 프록시가 한다.
 * 출원인 검색이 토큰 검색이라 "알체라" 로 부르면 2.3만 건이 걸리는데,
 * 그 걸러내기를 화면에서 하면 매번 상류를 여러 번 두드려야 한다.
 */
export function fetchPatents(company) {
  return get(`/api/kipris/patents?applicant=${encodeURIComponent(company)}`)
}

export function fetchTrademarks(company) {
  return get(`/api/kipris/trademarks?applicant=${encodeURIComponent(company)}`)
}

export function fetchDesigns(company) {
  return get(`/api/kipris/designs?applicant=${encodeURIComponent(company)}`)
}

/**
 * 사업자등록 상태(국세청). 사업자번호가 있어야만 부를 수 있다 —
 * 상호로는 조회되지 않고, 번호를 추측하면 남의 회사 상태를 보여 준다.
 */
export function fetchBizStatus(bizNo) {
  const n = String(bizNo || '').replace(/\D/g, '')
  if (n.length !== 10) throw new Error('사업자등록번호 10자리를 읽지 못했습니다.')
  return get(`/api/nts/status?bizNo=${n}`)
}

/**
 * 공공조달 낙찰 실적(조달청 나라장터).
 *
 * 상류가 조회 기간을 1개월까지만 받아 개월 수만큼 호출이 늘어난다.
 * 기본 12개월로 두고, 더 긴 기간은 화면에서 눌러 늘린다.
 */
export function fetchProcurement(company, bizNo, months = 12) {
  const q = new URLSearchParams({ months: String(months) })
  const n = String(bizNo || '').replace(/\D/g, '')
  // 사업자번호가 있으면 그것만 보낸다. 상호는 동명 업체가 섞인다.
  if (n.length === 10) q.set('bizNo', n)
  else if (company) q.set('name', company)
  else throw new Error('사업자등록번호나 회사명이 필요합니다.')
  return get(`/api/g2b/awards?${q}`)
}

/**
 * 자본조달. 보고서에는 DART 고유번호가 없어 회사명으로 기업 색인에서 찾는다.
 * 이름이 정확히 같은 것만 받아들인다 — 부분일치를 쓰면 남의 회사를 물어 온다.
 */
export async function fetchFunding(companyName, onPhase) {
  onPhase?.('고유번호 확인 중')
  const hits = await searchCompanies(companyName, 40)
  const norm = (x) => String(x || '').replace(/\s+/g, '')
  const hit = hits.find((h) => norm(h.name) === norm(companyName))
  if (!hit) throw new Error(`DART 에서 "${companyName}" 와 이름이 정확히 같은 회사를 찾지 못했습니다.`)
  return fetchFundingRounds(hit.code, onPhase)
}

/** 고용. 국민연금은 사업자번호를 주면 동명 사업장을 걸러낼 수 있다. */
export function fetchEmploymentFor(company, bizNo) {
  return fetchEmployment(company, bizNo)
}

/**
 * 새 회사를 처음 등록했을 때 셋을 미리 받아 DB 에 넣는다.
 *
 * 회사를 올려 놓고 탭마다 '받아오기' 를 세 번 누르게 하는 건 번거롭다.
 * 등록은 회사당 한 번뿐이라 이때 한 번 받아 두면 한도에도 부담이 없다.
 * (이미 있는 회사에 다른 연도를 더 올릴 때는 부르지 않는다 — 호출만 늘고 값은 같다)
 *
 * 하나가 실패해도 나머지는 저장한다. 실패는 조용히 넘긴다 —
 * 업로드는 이미 끝났고, 사용자는 탭에서 '받아오기' 로 다시 시도할 수 있다.
 *
 * 상표·디자인·조달실적은 여기서 받지 않는다. 상표·디자인은 KIPRIS 무료 한도(월 1,000회)를
 * 특허와 나눠 쓰고, 조달실적은 개월 수만큼 호출이 늘어난다 — 회사를 올릴 때마다 다 받으면
 * 등록 몇 번으로 한도가 녹는다. 사업자상태만 예외로 받는다(한 회사에 딱 1회다).
 *
 * @returns {Promise<{employment:boolean, funding:boolean, patents:boolean, bizStatus:boolean}>} 저장 성공 여부
 */
export async function prefetchExternals(companyKey, { company, bizNo } = {}) {
  const done = { employment: false, funding: false, patents: false, bizStatus: false }
  if (!companyKey || !company || !hasProxy) return done

  const tasks = [
    ['employment', async () => {
      const v = await fetchEmploymentFor(company, bizNo)
      await saveEmployment(companyKey, { ...v, name: company, bizNo: bizNo ?? null })
    }],
    ['funding', async () => {
      const v = await fetchFunding(company)
      await saveFunding(companyKey, v)
    }],
    ['patents', async () => {
      const v = await fetchPatents(company)
      await savePatents(companyKey, v)
    }],
  ]

  // 사업자번호를 표지에서 읽은 회사만. 없으면 부를 방법이 없다.
  if (String(bizNo || '').replace(/\D/g, '').length === 10) {
    tasks.push(['bizStatus', async () => {
      const v = await fetchBizStatus(bizNo)
      await saveBizStatus(companyKey, v)
    }])
  }

  await Promise.all(
    tasks.map(async ([key, run]) => {
      try {
        await run()
        done[key] = true
      } catch {
        /* 조용히 넘긴다. 탭에서 다시 받아올 수 있다 */
      }
    })
  )
  return done
}
