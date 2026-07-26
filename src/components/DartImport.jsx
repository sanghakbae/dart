import { useCallback, useEffect, useRef, useState } from 'react'
import { searchCompanies, fetchFilings, fetchDocumentFile } from '../lib/dart/api'
import { Callout, Empty, Badge } from './ui'

/**
 * DART 에서 감사보고서 원문을 바로 가져온다.
 *
 * 사용자가 뷰어에서 어떤 파일을 받았느냐에 따라 표지만 담긴 조각이 올라오는 일이 잦았다.
 * 여기서 받으면 원문 XML 전체가 그대로 오므로 그 문제가 없다.
 * 받은 파일은 업로드와 똑같이 onFiles() 로 흘려보낸다 — 파서·저장·화면을 그대로 쓴다.
 */
export default function DartImport({ onFiles, busy }) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState(null)
  const [filings, setFilings] = useState([])
  const [truncated, setTruncated] = useState(false)
  const [loadingFilings, setLoadingFilings] = useState(false)
  const [error, setError] = useState(null)
  const [pulling, setPulling] = useState(null)
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

  const pick = useCallback(async (c) => {
    setPicked(c)
    setFilings([])
    setTruncated(false)
    setError(null)
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
        <label className="modal-label" htmlFor="dart-q">DART 에서 회사를 찾아 원문을 바로 가져옵니다</label>
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
              {hits.map((c) => (
                <li key={c.code}>
                  <button type="button" onClick={() => pick(c)} disabled={busy}>
                    <span className="dh-name">{c.name}</span>
                    {c.stock ? <Badge tone="info">상장 {c.stock}</Badge> : <Badge tone="muted">비상장</Badge>}
                    <span className="dh-code">{c.code}</span>
                  </button>
                </li>
              ))}
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
            <ul className="dart-hits">
              {filings.map((f) => (
                <li key={f.rceptNo}>
                  <button type="button" onClick={() => pull(f)} disabled={busy || pulling}>
                    <span className="dh-name">{f.reportNm}</span>
                    <span className="dh-code">{fmtDate(f.rceptDt)}</span>
                    <span className="dh-go">{pulling === f.rceptNo ? '가져오는 중…' : '가져오기'}</span>
                  </button>
                </li>
              ))}
            </ul>
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

function fmtDate(d) {
  const s = String(d || '')
  return s.length === 8 ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s
}
