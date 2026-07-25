import { useMemo, useState } from 'react'
import { Card, Disclose, Empty, Callout, NoteBody } from '../ui'

export default function NotesTab({ report, notes, loading }) {
  const [q, setQ] = useState('')
  const items = notes?.items || []

  const filtered = useMemo(() => {
    const term = q.trim()
    if (!term) return items
    const lower = term.toLowerCase()
    return items.filter((n) => `${n.no} ${n.title} ${n.body}`.toLowerCase().includes(lower))
  }, [items, q])

  if (loading) return <Card><Empty title="주석을 불러오는 중입니다…" /></Card>

  if (!items.length) {
    const index = report.notesIndex || []
    return (
      <Card title="주석">
        {index.length ? (
          <>
            <Callout tone="warn">주석 본문을 불러오지 못했습니다. 아래는 저장된 주석 목차입니다.</Callout>
            <ol style={{ paddingLeft: 20, marginTop: 12 }}>
              {index.map((n) => (
                <li key={n.no} style={{ marginBottom: 4 }}>
                  {n.title} <span className="chip">{(n.length || 0).toLocaleString('ko-KR')}자</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <Empty title="주석을 찾지 못했습니다">
            감사보고서 본문만 담긴 파일이거나, 주석 표제를 인식하지 못했습니다. 원문 탭에서 전체 텍스트를 확인할 수 있습니다.
          </Empty>
        )}
      </Card>
    )
  }

  return (
    <div className="stack-lg">
      <Card title="주석" sub={`${items.length}개 항목 · 본문 전체 보존`}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="주석 내용 검색 (예: 우발부채, 특수관계자, 리스)"
          aria-label="주석 검색"
          style={{
            width: '100%', padding: '10px 13px', fontSize: 14, fontFamily: 'inherit',
            borderRadius: 8, border: '1px solid var(--border-strong)',
            background: 'var(--surface-1)', color: 'var(--text-1)',
          }}
        />
        <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
          {q.trim() ? `${filtered.length}개 항목에서 발견` : '항목을 눌러 본문을 펼칩니다.'}
        </div>
      </Card>

      <Card tight>
        {filtered.length ? (
          filtered.map((n) => (
            <Disclose key={`${n.no}-${n.title}`} summary={`${n.no}. ${n.title}`} count={`${(n.body || '').length.toLocaleString('ko-KR')}자${n.page ? ` · ${n.page}p` : ''}`}>
              <NoteBody content={n.content} body={n.body} muted />
            </Disclose>
          ))
        ) : (
          <div className="card-body"><Empty title="검색 결과가 없습니다" /></div>
        )}
      </Card>
    </div>
  )
}
