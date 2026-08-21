import { useCallback, useEffect, useRef, useState } from 'react'
import { searchCompanies, fetchFilings, fetchDocumentFile } from '../lib/dart/api'
import { filingKind, filingPeriodKey, filingBasisCode } from '../lib/dart/filingKind'
import { normalizeCompany } from '../lib/company'
import { Callout, Empty, Badge } from './ui'

/**
 * DART 에서 감사보고서 원문을 바로 가져온다.
 *
 * 사용자가 뷰어에서 어떤 파일을 받았느냐에 따라 표지만 담긴 조각이 올라오는 일이 잦았다.
 * 여기서 받으면 원문 XML 전체가 그대로 오므로 그 문제가 없다.
 * 받은 파일은 업로드와 똑같이 onFiles() 로 흘려보낸다 — 파서·저장·화면을 그대로 쓴다.
 *
 * @param {Map<string, Set<string>>} [imported] 정규화한 회사명 → 이미 받은 기간 키("2025-FY")
 */
export default function DartImport({ onFiles, busy, imported }) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [filings, setFilings] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loadingFilings, setLoadingFilings] = useState(false)
  const [error, setError] = useState(null)
  const [pulling, setPulling] = useState(null)
  const [showPeriodic, setShowPeriodic] = useState(false) // 분기·반기는 접어 둔다
  // 이름이 같은 회사들의 최근 공시 — code → { latest, count }
  const [sameName, setSameName] = useState({})
  const seq = useRef(0)

  // 검색은 12만 건 색인을 훑으므로 입력이 멈춘 뒤에 돈다.
  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    const my = ++seq.current
    setSearching(true)
    const t = setTimeout(() => {
      searchCompanies(q)
        .then((r) => my === seq.current && setHits(r))
        .catch((e) => my === seq.current && setError(e.message))
        .finally(() => my === seq.current && setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [term])

  /**
   * 이름이 똑같은 회사가 둘 이상 걸리면 코드만 보고는 고를 수 없다.
   *
   * '세스코' 로 찾으면 둘이 나오는데, 공시가 2014년 1건뿐인 쪽이 먼저 떴다.
   * 그걸 고르면 2025년 감사보고서가 목록에 없어 "안 받아진다" 로 보인다.
   * 그래서 겹치는 것만 공시를 확인해 최근 공시일을 적어 주고, 최근 것부터 세운다.
   */
  useEffect(() => {
    const byName = new Map()
    for (const h of hits) {
      const k = normalizeCompany(h.name)
      const g = byName.get(k) || []
      g.push(h)
      byName.set(k, g)
    }
    // 겹치는 것만 본다 — 검색마다 전부 확인하면 호출이 너무 늘어난다.
    const dups = [...byName.values()].filter((g) => g.length > 1).flat().slice(0, 6)
    if (!dups.length) return undefined

    let alive = true
    Promise.all(
      dups.map(async (h) => {
        try {
          const { list } = await fetchFilings(h.code)
          return [h.code, { latest: list[0]?.rceptDt || null, count: list.length }]
        } catch {
          return [h.code, { latest: null, count: null }]
        }
      })
    ).then((rows) => {
      if (alive) setSameName((prev) => ({ ...prev, ...Object.fromEntries(rows) }))
    })
    return () => {
      alive = false
    }
  }, [hits])

  const pick = useCallback(async (c) => {
    setPicked(c)
    setFilings([])
    setTruncated(false)
    setError(null)
    setShowPeriodic(false)
    setLoadingFilings(true)
    try {
      const { list, truncated: cut } = await fetchFilings(c.code)
      setFilings(list)
      setTruncated(Boolean(cut))
      if (!list.length) setError(`${c.name} 의 감사보고서·정기보고서 공시가 없습니다.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingFilings(false)
    }
  }, [])

  const pull = useCallback(
    async (f) => {
      setPulling(f.rceptNo)
      setError(null)
      try {
        // 파일명에 회사명을 넣어 둔다 — 파서가 회사 판정에 이 이름을 먼저 쓴다.
        const name = `[${picked.name}]${f.reportNm}(${fmtDate(f.rceptDt)}).html`
        const file = await fetchDocumentFile(f.rceptNo, name)
        // 접수번호를 파일에 얹어 보낸다. 파서가 meta.rceptNo 로 옮겨 담아 두면
        // 나중에 원문 탭에서 DART 공식 뷰어(=PDF 내려받기가 있는 곳)를 열 수 있다.
        file.rceptNo = f.rceptNo
        await onFiles([file])
      } catch (e) {
        setError(e.message)
      } finally {
        setPulling(null)
      }
    },
    [picked, onFiles]
  )

  return (
    <div className="stack">
      <div>
        <label className="modal-label" htmlFor="dart-q">회사명으로 찾기</label>
        <input
          id="dart-q"
          className="modal-input"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="회사명 두 글자 이상 (예: 무하유)"
          autoComplete="off"
          disabled={busy}
        />
      </div>

      {error && <Callout tone="warn">{error}</Callout>}

      {!picked && (
        <>
          {searching && <div className="tnote">찾는 중…</div>}
          {!searching && term.trim().length >= 2 && !hits.length && (
            <div className="tnote">일치하는 회사가 없습니다.</div>
          )}
          {hits.length > 0 && (
            <ul className="dart-hits">
              {orderHits(hits, sameName).map((c) => {
                const info = sameName[c.code]
                return (
                  <li key={c.code}>
                    <button type="button" onClick={() => pick(c)} disabled={busy}>
                      <span className="dh-name">{c.name}</span>
                      {c.stock ? <Badge tone="info">상장 {c.stock}</Badge> : <Badge tone="muted">비상장</Badge>}
                      {/* 이름이 같은 회사가 있을 때만 붙는다 — 무엇으로 갈라야 할지 알려주는 값이다 */}
                      {info && (
                        <span className="dh-last">
                          {info.latest ? `최근 공시 ${fmtDate(info.latest)}` : '공시 없음'}
                        </span>
                      )}
                      <span className="dh-code">{c.code}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {picked && (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-ghost" type="button" onClick={() => { setPicked(null); setFilings([]); setError(null) }}>
              ‹ 다른 회사
            </button>
            <strong>{picked.name}</strong>
            <span className="dh-code">{picked.code}</span>
          </div>

          {loadingFilings ? (
            <div className="tnote">공시 목록을 불러오는 중…</div>
          ) : filings.length ? (
            (() => {
              // 연 1회 감사받은 재무제표(상장사 사업보고서 · 비상장사 감사보고서)만
              // 앞세운다. 분기·반기는 검토만 받은 것이라 연간 추이에 섞으면 어긋나므로
              // 접어 두고, 필요할 때만 펼친다.
              // 서버가 kind 를 붙여 주지만(dart-handler.filingKind), 프록시가 옛 버전이면
              // 안 온다. 그때도 어긋나지 않게 이름으로 한 번 더 갈라 준다.
              const kindOf = (f) => f.kind || filingKind(f.reportNm)
              const annual = filings.filter((f) => kindOf(f) === 'annual')
              const periodic = filings.filter((f) => kindOf(f) !== 'annual')

              // 이미 받아 둔 공시는 잠근다. 같은 것을 다시 받아도 덮어쓰기만 하는데,
              // 목록만 보고는 무엇을 받았는지 알 수 없어 또 눌러 보게 된다.
              const have = imported?.get(normalizeCompany(picked.name)) || null
              const isDone = (f) => {
                const k = filingPeriodKey(f.reportNm)
                if (!k || !have) return false
                const code = filingBasisCode(f.reportNm)
                // 이름으로 연결여부를 알 수 있으면 그것만 본다. 사업보고서처럼
                // 알 수 없으면 둘 중 하나라도 있으면 받은 것으로 본다.
                return code ? have.has(`${k}-${code}`) : have.has(`${k}-s`) || have.has(`${k}-c`)
              }

              const row = (f) => {
                const done = isDone(f)
                return (
                  <li key={f.rceptNo}>
                    <button
                      type="button"
                      onClick={() => pull(f)}
                      disabled={busy || Boolean(pulling) || done}
                      title={done ? '이미 받아 둔 보고기간입니다' : undefined}
                    >
                      <span className="dh-name">{f.reportNm}</span>
                      <span className="dh-code">{fmtDate(f.rceptDt)}</span>
                      {done ? (
                        <span className="dh-go done">가져옴</span>
                      ) : (
                        <span className="dh-go">{pulling === f.rceptNo ? '가져오는 중…' : '가져오기'}</span>
                      )}
                    </button>
                  </li>
                )
              }
              const doneCount = filings.filter(isDone).length
              return (
                <>
                  {doneCount > 0 && (
                    <div className="tnote">
                      이미 받아 둔 <strong>공시 {doneCount}건</strong>은 잠갔습니다. 다시 받으려면 회사
                      화면에서 그 보고서를 지우거나, 파일로 올려 주세요.
                      {/* 원본과 정정본은 같은 보고서로 저장되므로, 공시 수가 보고서 수보다 많을 수 있다. */}
                    </div>
                  )}
                  {annual.length > 0 && <ul className="dart-hits">{annual.map(row)}</ul>}
                  {annual.length === 0 && (
                    <Callout tone="warn">
                      연간 보고서(사업보고서·감사보고서)가 목록에 없습니다. 최근 것부터 일부만 불러왔을 수
                      있으니 아래에서 분기·반기를 펼쳐 확인하거나, 해당 연도는 파일로 올려 주세요.
                    </Callout>
                  )}
                  {periodic.length > 0 && (
                    <div className="stack" style={{ marginTop: annual.length ? 10 : 0 }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => setShowPeriodic((v) => !v)}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        {showPeriodic ? '분기·반기 접기' : `분기·반기 보고서 ${periodic.length}건 보기`}
                      </button>
                      {showPeriodic && (
                        <>
                          <div className="tnote">
                            분기·반기는 감사가 아니라 검토만 받은 보고서입니다. 연간 추이에 섞으면 기간이 달라
                            비교가 어긋나므로 따로 두었습니다.
                          </div>
                          <ul className="dart-hits">{periodic.map(row)}</ul>
                        </>
                      )}
                    </div>
                  )}
                </>
              )
            })()
          ) : (
            !error && <Empty title="공시가 없습니다" />
          )}

          {truncated && (
            <Callout tone="warn">
              공시가 많아 <strong>최근 것부터 일부만</strong> 불러왔습니다. 더 오래된 보고서는 목록에
              없을 수 있습니다 — 그 연도는 파일로 올려 주세요.
            </Callout>
          )}
        </>
      )}
    </div>
  )
}

/**
 * 이름이 같은 회사는 최근 공시가 있는 쪽을 위로 올린다.
 *
 * DART 색인 순서대로 두면 폐업한 동명 회사가 먼저 뜬다 — 세스코는 공시가
 * 2014년 1건뿐인 쪽이 먼저였다. 확인이 끝난 것만 다시 세우고 나머지 순서는 건드리지 않는다.
 */
function orderHits(hits, sameName) {
  if (!Object.keys(sameName).length) return hits
  const key = (c) => sameName[c.code]?.latest || ''
  return [...hits].sort((a, b) => {
    // 확인하지 않은 항목끼리는 원래 순서를 지킨다.
    if (!sameName[a.code] || !sameName[b.code]) return 0
    return key(b).localeCompare(key(a))
  })
}

function fmtDate(d) {
  const s = String(d || '')
  return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s
}
