import { useMemo, useState } from 'react'
import { Card, Empty, Callout } from '../ui'
import { fileSize } from '../../lib/format'

const PAGE = 120_000 // 한 번에 렌더할 글자 수 — 초장문 보고서에서도 브라우저가 버티게

export default function RawTab({ report, rawText, loading, onDownload }) {
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const text = rawText || ''

  const hits = useMemo(() => {
    const term = q.trim()
    if (!term || !text) return null
    const lower = text.toLowerCase()
    const t = term.toLowerCase()
    const out = []
    let i = lower.indexOf(t)
    while (i >= 0 && out.length < 300) {
      out.push({ i, snippet: text.slice(Math.max(0, i - 90), i + term.length + 110) })
      i = lower.indexOf(t, i + t.length)
    }
    return out
  }, [q, text])

  if (loading) return <Card><Empty title="원문을 불러오는 중입니다…" /></Card>
  if (!text) return <Card><Empty title="저장된 원문이 없습니다">보고서를 다시 업로드하면 원문이 함께 저장됩니다.</Empty></Card>

  return (
    <div className="stack-lg">
      <Card
        title="추출 원문"
        sub={`${text.length.toLocaleString('ko-KR')}자 · ${report.stats?.rowCount?.toLocaleString('ko-KR') || '?'}행${report.stats?.pageCount ? ` · ${report.stats.pageCount}p` : ''}`}
        right={
          <button className="btn btn-sm" onClick={onDownload} type="button">텍스트 내려받기</button>
        }
      >
        <Callout>
          업로드한 파일에서 추출한 텍스트 전체입니다. 이 원문이 그대로 DB에 저장되어, 분석 로직이 놓친 내용도 여기서 직접 확인할 수 있습니다.
        </Callout>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="원문 검색 (예: 소송, 담보, 특수관계자, 차입금)"
          aria-label="원문 검색"
          style={{
            width: '100%', marginTop: 12, padding: '10px 13px', fontSize: 14, fontFamily: 'inherit',
            borderRadius: 8, border: '1px solid var(--border-strong)',
            background: 'var(--surface-1)', color: 'var(--text-1)',
          }}
        />
        {hits && (
          <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
            {hits.length ? `${hits.length}${hits.length >= 300 ? '+' : ''}건 발견` : '검색 결과 없음'}
          </div>
        )}
      </Card>

      {hits?.length ? (
        <Card title="검색 결과" sub={`“${q.trim()}” 주변 문맥`} tight>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {hits.map((h) => (
              <div key={h.i} style={{ padding: '10px clamp(12px, 2vw, 20px)', borderBottom: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }}>
                <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', marginRight: 8 }}>{h.i.toLocaleString('ko-KR')}</span>
                <Highlight text={h.snippet} term={q.trim()} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card title="전체 텍스트">
        <div className="raw">{text.slice(0, shown)}</div>
        {shown < text.length && (
          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-sm" onClick={() => setShown((s) => s + PAGE)} type="button">
              다음 {PAGE.toLocaleString('ko-KR')}자 더 보기
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setShown(text.length)} type="button">전체 펼치기</button>
            <span className="chip">
              {Math.min(shown, text.length).toLocaleString('ko-KR')} / {text.length.toLocaleString('ko-KR')}자
            </span>
          </div>
        )}
      </Card>
    </div>
  )
}

function Highlight({ text, term }) {
  if (!term) return <>{text}</>
  const parts = text.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} style={{ background: 'color-mix(in srgb, var(--warning) 40%, transparent)', color: 'inherit', borderRadius: 3, padding: '0 2px' }}>
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}
