// 외부 조회(고용·투자·특허) 한 곳.
//
// 탭마다 제 나름의 조회 함수를 두었더니, 새 회사 등록 때 미리 받아 두는 코드와
// 갈라질 위험이 생겼다. 조회는 여기 하나만 두고 탭도 등록 훅도 같은 것을 쓴다.
//
// 셋 다 상류 호출이 무겁다 — 국민연금은 한 회사에 13회 안팎에 10초쯤 걸리고,
// KIPRIS 는 무료 한도가 월 1,000회, DART 자본조달은 공시마다 원문을 한 번씩 받는다.
// 그래서 탭을 열 때마다 받지 않고, 받은 것은 DB 에 넣어 두고 쓴다.

import { fetchEmployment } from './nps/api.js'
import { fetchFundingRounds } from './dart/funding.js'
import { searchCompanies } from './dart/api.js'
import { proxyUrl, hasProxy } from './proxyBase.js'
import { saveEmployment, saveFunding, savePatents } from './storage.js'


/**
 * 특허. 이름 변형(주식회사 유무)과 정확 일치 판정은 프록시가 한다.
 * 출원인 검색이 토큰 검색이라 "알체라" 로 부르면 2.3만 건이 걸리는데,
 * 그 걸러내기를 화면에서 하면 매번 상류를 여러 번 두드려야 한다.
 */
export async function fetchPatents(company) {
  const res = await fetch(proxyUrl(`/api/kipris/patents?applicant=${encodeURIComponent(company)}`))
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
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
 * @returns {Promise<{employment:boolean, funding:boolean, patents:boolean}>} 저장 성공 여부
 */
export async function prefetchExternals(companyKey, { company, bizNo } = {}) {
  const done = { employment: false, funding: false, patents: false }
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
    // 국세청 상태 조회는 뺐다. data.go.kr 이 배포 환경(Cloudflare)에서 요청을
    // 즉시 거절해, 등록할 때마다 실패만 쌓였다. 상류가 열리면 이 항목만 되살리면 된다.
  ]

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
