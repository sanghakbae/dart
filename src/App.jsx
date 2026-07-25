import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider, isFirebaseConfigured, ALLOWED_EMAILS } from './firebase'
import { analyzeFile } from './lib/parse'
import { saveReport, listReports, loadContent, deleteReport, backendLabel } from './lib/storage'
import { buildTimeline } from './lib/analyze/series'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import { Card, Badge, Empty, Callout } from './components/ui'
import SummaryTab from './components/tabs/SummaryTab'
import OpinionTab from './components/tabs/OpinionTab'
import StatementsTab from './components/tabs/StatementsTab'
import TrendTab from './components/tabs/TrendTab'
import RatioTab from './components/tabs/RatioTab'
import NotesTab from './components/tabs/NotesTab'
import RawTab from './components/tabs/RawTab'
import { dateTimeText, fileSize } from './lib/format'

const TABS = [
  { key: 'summary', label: '요약' },
  { key: 'opinion', label: '감사의견' },
  { key: 'statements', label: '재무제표' },
  { key: 'trend', label: '추이' },
  { key: 'ratio', label: '재무비율' },
  { key: 'notes', label: '주석' },
  { key: 'raw', label: '원문' },
]

export default function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(!isFirebaseConfigured)
  const [reports, setReports] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [tab, setTab] = useState('summary')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [toasts, setToasts] = useState([])
  const [content, setContent] = useState({}) // id → {rawText, blocks, notes, sections}
  const [contentLoading, setContentLoading] = useState(false)
  const [scope, setScope] = useState('company') // 추이 병합 범위
  const [theme, setTheme] = useState(() => localStorage.getItem('dart-theme') || 'auto')
  const contentReq = useRef(0)

  const uid = user?.uid || null
  const storage = backendLabel(uid)

  const toast = useCallback((text, tone) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 9000 : 4500)
  }, [])

  // 테마
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('dart-theme', theme)
  }, [theme])

  // 로그인 상태
  useEffect(() => {
    if (!isFirebaseConfigured || !auth) return
    return onAuthStateChanged(auth, (u) => {
      if (u && ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes((u.email || '').toLowerCase())) {
        toast(`${u.email} 계정은 허용되지 않았습니다.`, 'bad')
        signOut(auth)
        setUser(null)
      } else {
        setUser(u)
      }
      setAuthReady(true)
    })
  }, [toast])

  // 저장된 목록 로드
  const refresh = useCallback(async () => {
    try {
      const list = await listReports(uid)
      setReports(list)
      setActiveId((cur) => cur || list[0]?.id || null)
    } catch (e) {
      toast(`목록을 불러오지 못했습니다: ${e.message}`, 'bad')
    }
  }, [uid, toast])

  useEffect(() => {
    if (authReady) refresh()
  }, [authReady, refresh])

  const active = useMemo(() => reports.find((r) => r.id === activeId) || null, [reports, activeId])

  // 본문(원문·표·주석) 지연 로드
  useEffect(() => {
    if (!active) return
    if (content[active.id]) return
    const seq = ++contentReq.current
    setContentLoading(true)
    loadContent(active.id, uid, active.storage)
      .then((c) => {
        if (seq !== contentReq.current) return
        setContent((prev) => ({ ...prev, [active.id]: c || { rawText: '', blocks: [], notes: { items: [] }, sections: [] } }))
      })
      .catch(() => {
        if (seq === contentReq.current) toast('저장된 본문을 불러오지 못했습니다.', 'bad')
      })
      .finally(() => {
        if (seq === contentReq.current) setContentLoading(false)
      })
  }, [active, content, uid, toast])

  const handleFiles = useCallback(
    async (files) => {
      setBusy(true)
      let lastId = null
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const base = i / files.length
        const span = 1 / files.length
        try {
          setPhase(`${file.name} 분석 중`)
          const report = await analyzeFile(file, (p, msg) => {
            setProgress(base + span * p)
            if (msg) setPhase(`${file.name} — ${msg}`)
          })
          setPhase(`${file.name} 저장 중`)
          const saved = await saveReport(report, uid)
          setContent((prev) => ({
            ...prev,
            [report.id]: { rawText: report.rawText, blocks: report.blocks, notes: report.notes, sections: report.sections },
          }))
          setReports((prev) => [summaryOf(saved), ...prev.filter((r) => r.id !== saved.id)])
          lastId = saved.id
          const warn = report.quality?.warnings?.length
          toast(
            `${report.meta.company} ${report.meta.fiscalYear || ''} 분석 완료 · ${storage.mode === 'firestore' ? 'DB 저장됨' : '브라우저에 저장됨'}${warn ? ` (확인 필요 ${warn}건)` : ''}`,
            warn ? 'warn' : undefined
          )
        } catch (e) {
          toast(`${file.name}: ${e.message}`, 'bad')
        }
      }
      setProgress(1)
      setBusy(false)
      setPhase('')
      if (lastId) {
        setActiveId(lastId)
        setTab('summary')
      }
    },
    [uid, storage.mode, toast]
  )

  // 실재하지 않는 가상 회사로 만든 기능 확인용 예시 파일
  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/sample-audit-report.html`)
      if (!res.ok) throw new Error(`예시 파일을 찾을 수 없습니다 (${res.status})`)
      const blob = await res.blob()
      await handleFiles([new File([blob], '예시-감사보고서(가상회사).html', { type: 'text/html' })])
    } catch (e) {
      toast(e.message, 'bad')
    }
  }, [handleFiles, toast])

  const handleDelete = useCallback(
    async (id) => {
      const target = reports.find((r) => r.id === id)
      if (!target) return
      if (!window.confirm(`‘${target.meta?.company || id}’ 보고서와 저장된 원문 전체를 삭제합니다. 계속할까요?`)) return
      try {
        await deleteReport(id, uid)
        setReports((prev) => prev.filter((r) => r.id !== id))
        setContent((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        if (activeId === id) setActiveId(null)
        toast('삭제했습니다.')
      } catch (e) {
        toast(`삭제 실패: ${e.message}`, 'bad')
      }
    },
    [reports, uid, activeId, toast]
  )

  // 추이 병합 대상
  const timelineReports = useMemo(() => {
    if (!active) return []
    if (scope === 'all') return reports
    const key = normalizeCompany(active.meta?.company)
    const same = reports.filter((r) => normalizeCompany(r.meta?.company) === key)
    return same.length ? same : [active]
  }, [reports, active, scope])

  const timeline = useMemo(() => buildTimeline(timelineReports), [timelineReports])

  const activeContent = active ? content[active.id] : null
  const mergedActive = useMemo(() => {
    if (!active) return null
    return { ...active, ...(activeContent ? { notes: activeContent.notes, sections: activeContent.sections } : null) }
  }, [active, activeContent])

  const downloadRaw = useCallback(() => {
    if (!activeContent?.rawText) return
    const blob = new Blob([activeContent.rawText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.meta?.company || 'report'}-${active.meta?.fiscalYear || ''}-원문.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [activeContent, active])

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      toast(`로그인 실패: ${e.message}`, 'bad')
    }
  }

  const counts = {
    statements: activeContent?.blocks?.length ?? null,
    notes: mergedActive?.notesCount ?? mergedActive?.notes?.count ?? null,
    trend: timeline.years.length || null,
  }

  return (
    <>
      <Header
        storage={storage}
        user={user}
        canLogin={isFirebaseConfigured}
        onLogin={login}
        onLogout={() => signOut(auth)}
        theme={theme === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme}
        onTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      <main className="wrap stack-lg" style={{ paddingTop: 20 }}>
        {!reports.length && !busy && (
          <div className="stack">
            <UploadZone onFiles={handleFiles} onSample={loadSample} busy={busy} progress={progress} phase={phase} />
            <div className="grid">
              <Card title="무엇을 읽어내나요">
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.9 }}>
                  <li>감사의견 유형(적정·한정·부적정·의견거절)과 의견근거 원문</li>
                  <li>핵심감사사항(KAM), 강조사항, 계속기업 불확실성, 내부회계관리제도</li>
                  <li>재무상태표 · 손익계산서 · 포괄손익 · 자본변동표 · 현금흐름표 전체 행</li>
                  <li>주석 전체 본문(항목별 분리 + 검색)</li>
                  <li>수익성 · 안정성 · 활동성 · 현금흐름 재무비율</li>
                  <li>당기 · 전기 비교와 연도별 추이 그래프</li>
                </ul>
              </Card>
              <Card title="저장 방식">
                <Callout>{storage.hint}</Callout>
                <p style={{ marginTop: 12, fontSize: 13.5, color: 'var(--text-2)' }}>
                  파싱 결과와 <strong>추출 원문 전체</strong>가 함께 저장됩니다. 원문은 1MB 문서 한도를 넘길 수 있어
                  자동으로 조각내어 저장하고, 다시 열 때 합쳐서 복원합니다.
                </p>
              </Card>
            </div>
          </div>
        )}

        {(reports.length > 0 || busy) && (
          <>
            <UploadZone onFiles={handleFiles} busy={busy} progress={progress} phase={phase} compact />

            <section>
              <div className="card-head" style={{ border: 'none', padding: '0 0 8px', gap: 10 }}>
                <h3>저장된 보고서 {reports.length}건</h3>
                <span className="sub">{storage.hint}</span>
              </div>
              <div className="rep-scroll">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`rep${r.id === activeId ? ' active' : ''}`}
                    onClick={() => setActiveId(r.id)}
                  >
                    <span className="t">{r.meta?.company || r.id}</span>
                    <span className="m">
                      <span>{r.meta?.fiscalYear ? `${r.meta.fiscalYear}년` : '연도 미확인'}</span>
                      <span>·</span>
                      <span>{r.meta?.basis}</span>
                      <span>·</span>
                      <span>{r.opinion?.label || '의견 미확인'}</span>
                    </span>
                    <span className="m">
                      <span>{r.storage === 'firestore' ? 'DB' : '로컬'}</span>
                      <span>·</span>
                      <span>{dateTimeText(r.createdAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {active ? (
              <>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Badge tone={active.opinion?.tone} dot>{active.opinion?.label || '의견 미확인'}</Badge>
                  <strong style={{ fontSize: 16 }}>{active.meta?.company}</strong>
                  <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
                    {active.meta?.fiscalYear ? `${active.meta.fiscalYear}년 · ` : ''}
                    {active.meta?.basis} · {active.meta?.fileName} ({fileSize(active.meta?.fileSize)})
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      type="button"
                      onClick={() => setScope((s) => (s === 'all' ? 'company' : 'all'))}
                      title="추이 그래프에 합칠 보고서 범위"
                    >
                      추이 범위: {scope === 'all' ? '전체 보고서' : '같은 회사'}
                    </button>
                    <button className="btn btn-sm btn-danger" type="button" onClick={() => handleDelete(active.id)}>
                      삭제
                    </button>
                  </div>
                </div>

                <nav className="tabs" aria-label="분석 탭">
                  {TABS.map((t) => (
                    <button key={t.key} type="button" className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                      {t.label}
                      {counts[t.key] != null && <span className="n">{counts[t.key]}</span>}
                    </button>
                  ))}
                </nav>

                <div style={{ paddingTop: 4 }}>
                  {tab === 'summary' && <SummaryTab report={mergedActive} timeline={timeline} />}
                  {tab === 'opinion' && <OpinionTab report={mergedActive} sections={activeContent?.sections} loading={contentLoading} />}
                  {tab === 'statements' && <StatementsTab report={mergedActive} blocks={activeContent?.blocks} loading={contentLoading} />}
                  {tab === 'trend' && <TrendTab timeline={timeline} reports={timelineReports} />}
                  {tab === 'ratio' && <RatioTab report={mergedActive} timeline={timeline} />}
                  {tab === 'notes' && <NotesTab report={mergedActive} notes={activeContent?.notes} loading={contentLoading} />}
                  {tab === 'raw' && <RawTab report={mergedActive} rawText={activeContent?.rawText} loading={contentLoading} onDownload={downloadRaw} />}
                </div>
              </>
            ) : (
              <Card><Empty title="보고서를 선택하세요" /></Card>
            )}
          </>
        )}
      </main>

      <div className="toast-host">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'bad' ? ' bad' : ''}`}>
            <span aria-hidden="true">{t.tone === 'bad' ? '✕' : t.tone === 'warn' ? '!' : '✓'}</span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </>
  )
}

function summaryOf(report) {
  const { rawText, blocks, notes, sections, ...rest } = report
  return {
    ...rest,
    notesCount: notes?.count || 0,
    notesIndex: (notes?.items || []).map((n) => ({ no: n.no, title: n.title, page: n.page, length: n.body?.length || 0 })),
  }
}

function normalizeCompany(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/주식회사|\(주\)|㈜/g, '')
    .toLowerCase()
}
