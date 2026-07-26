// DART 가져오기 클라이언트.
//
// 인증키는 프록시(/api/dart/*)에만 있고 브라우저에는 없다.
// 기업 검색만 클라이언트에서 한다 — 12만 건짜리 색인을 한 번 받아 두고 메모리에서 찾는다
// (public/dart-corp-index.txt, 빌드 시 scripts/build-corp-index.mjs 가 굽는다).

import { proxyUrl } from '../proxyBase.js'

const INDEX_URL = `${import.meta.env.BASE_URL}dart-corp-index.txt`

let indexPromise = null

/** "고유번호,종목코드,회사명" 한 줄에 하나 */
function loadIndex() {
  if (indexPromise) return indexPromise
  indexPromise = fetch(INDEX_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`기업 목록을 불러오지 못했습니다 (${r.status})`)
      return r.text()
    })
    .then((text) => {
      // 색인이 배포에 포함되지 않으면 개발 서버·Pages 가 index.html 을 돌려준다.
      // 그대로 파싱하면 "검색 결과 없음" 처럼 보여 원인을 알 수 없다.
      if (/^\s*</.test(text)) {
        throw new Error(
          '기업 목록(dart-corp-index.txt)이 없습니다. 로컬에서는 `npm run build:corp`, ' +
            '배포본은 워크플로에서 DART_API_KEY 로 생성합니다.'
        )
      }
      const rows = []
      for (const line of text.split('\n')) {
        if (!line) continue
        const a = line.indexOf(',')
        const b = line.indexOf(',', a + 1)
        if (a < 0 || b < 0) continue
        rows.push({ code: line.slice(0, a), stock: line.slice(a + 1, b), name: line.slice(b + 1) })
      }
      return rows
    })
    .catch((e) => {
      indexPromise = null // 다음 시도에 다시 받도록
      throw e
    })
  return indexPromise
}

/** 회사명 부분일치 검색. 상장사와 이름이 짧은 쪽을 위로 올린다. */
export async function searchCompanies(term, limit = 30) {
  const q = String(term || '').trim().toLowerCase()
  if (q.length < 2) return []
  const rows = await loadIndex()
  const hits = []
  for (const r of rows) {
    const name = r.name.toLowerCase()
    const at = name.indexOf(q)
    if (at < 0) continue
    hits.push({ ...r, at })
    if (hits.length > 4000) break
  }
  hits.sort(
    (a, b) =>
      Number(Boolean(b.stock)) - Number(Boolean(a.stock)) || // 상장사 우선
      a.at - b.at || // 앞에서 일치할수록 위
      a.name.length - b.name.length
  )
  return hits.slice(0, limit)
}

async function getJson(path) {
  const res = await fetch(path)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || `요청 실패 (${res.status})`)
  return body
}

/** 감사보고서·정기보고서 공시 목록 */
export function fetchFilings(corpCode) {
  return getJson(proxyUrl(`/api/dart/filings?corp=${encodeURIComponent(corpCode)}`))
}

/** 기업개황 — 사업자등록번호·법인등록번호가 여기서만 나온다(감사보고서 본문에는 없다) */
export function fetchCompany(corpCode) {
  return getJson(proxyUrl(`/api/dart/company?corp=${encodeURIComponent(corpCode)}`))
}

/**
 * 공시 원문을 File 로 받아 온다.
 * 기존 업로드 파이프라인(analyzeFile)에 그대로 넣기 위해 File 로 감싼다.
 */
export async function fetchDocumentFile(rceptNo, fileName) {
  const res = await fetch(proxyUrl(`/api/dart/document?rcept=${encodeURIComponent(rceptNo)}`))
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.error || `원문을 받지 못했습니다 (${res.status})`)
  }
  const text = await res.text()
  return new File([text], fileName, { type: 'text/html' })
}
