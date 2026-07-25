import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeFile } from './lib/parse'
import { saveReport, listReports, loadContent, backendLabel } from './lib/storage'
import { buildTimeline } from './lib/analyze/series'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import CompanyList, { groupByCompany } from './components/CompanyList'
import { Card, Badge, Empty, Callout } from './components/ui'
import SummaryTab from './components/tabs/SummaryTab'
import OpinionTab from './components/tabs/OpinionTab'
import StatementsTab from './components/tabs/StatementsTab'
import TrendTab from './components/tabs/TrendTab'
import RatioTab from './components/tabs/RatioTab'
import NotesTab from './components/tabs/NotesTab'
import RawTab from './components/tabs/RawTab'
import { fileSize } from './lib/format'

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
  const [reports, setReports] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [companyKey, setCompanyKey] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [tab, setTab] = useState('summary')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [toasts, setToasts] = useState([])
  const [content, setContent] = useState({}) // id → {rawText, blocks, notes, sections}
  const [contentLoading, setContentLoading] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('dart-theme') || 'auto')
  const contentReq = useRef(0)

  const storage = backendLabel()

  const toast = useCallback((text, tone) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 9000 : 5000)
  }, [])

  // 테마
  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('dart-theme', theme)
  }, [theme])

  // DB 목록 로드
  const refresh = useCallback(async () => {
    try {
      const { reports: list, warning } = await listReports()
      setReports(list)
      if (warning) toast(warning, 'warn')
    } catch (e) {
      toast(`목록을 불러오지 못했습니다: ${e.message}`, 'bad')
    } finally {
      setLoadingList(false)
    }
  }, [toast])

  useEffect(() => {
    refresh()
  }, [refresh])

  const companies = useMemo(() => groupByCompany(reports), [reports])
  const company = useMemo(() => companies.find((c) => c.key === companyKey) || null, [companies, companyKey])
  const active = useMemo(() => {
    if (!company) return null
    return company.reports.find((r) => r.id === activeId) || company.latest
  }, [company, activeId])

  // 본문(원문·표·주석) 지연 로드
  useEffect(() => {
    if (!active || content[active.id]) return
    const seq = ++contentReq.current
    setContentLoading(true)
    loadContent(active.id)
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
  }, [active, content, toast])

  const handleFiles = useCallback(
    async (files) => {
      setBusy(true)
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
          setPhase(`${file.name} DB에 저장 중`)
          const { report: saved, storage: where, warning } = await saveReport(report)
          setContent((prev) => ({
            ...prev,
            [report.id]: { rawText: report.rawText, blocks: report.blocks, notes: report.notes, sections: report.sections },
          }))
          setReports((prev) => [summaryOf(saved), ...prev.filter((r) => r.id !== saved.id)])
          const warn = report.quality?.warnings?.length
          toast(
            `${report.meta.company} ${report.meta.fiscalYear || ''} ${where === 'firestore' ? 'DB에 저장했습니다' : '브라우저에 저장했습니다'}${warn ? ` (확인 필요 ${warn}건)` : ''}`,
            warn ? 'warn' : undefined
          )
          if (warning) toast(warning, 'warn')
        } catch (e) {
          toast(`${file.name}: ${e.message}`, 'bad')
        }
      }
      setProgress(1)
      setBusy(false)
      setPhase('')
    },
    [toast]
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

  const selectCompany = useCallback((c) => {
    setCompanyKey(c.key)
    setActiveId(c.latest?.id || null)
    setTab('summary')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const closeCompany = useCallback(() => {
    setCompanyKey(null)
    setActiveId(null)
  }, [])

  // 추이는 선택한 회사의 보고서를 모두 합쳐서 만든다.
  const timeline = useMemo(() => buildTimeline(company ? company.reports : []), [company])

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

  const counts = {
    statements: activeContent?.blocks?.length ?? null,
    notes: mergedActive?.notesCount ?? mergedActive?.notes?.count ?? null,
    trend: timeline.years.length || null,
  }

  return (
    <>
      <Header
        storage={storage}
        theme={theme === 'auto' ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme}
        onTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
      />

      <main className="wrap stack-lg" style={{ paddingTop: 20 }}>
        {!company ? (
          <>
            <UploadZone
              onFiles={handleFiles}
              onSample={reports.length ? undefined : loadSample}
              busy={busy}
              progress={progress}
              phase={phase}
              compact={reports.length > 0}
            />

            {loadingList ? (
              <Card><Empty title="DB에서 목록을 불러오는 중입니다…" /></Card>
            ) : (
              <CompanyList companies={companies} activeKey={companyKey} onSelect={selectCompany} />
            )}
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-sm btn-ghost" type="button" onClick={closeCompany}>
                ‹ 회사 목록
              </button>
              <strong style={{ fontSize: 17 }}>{company.name}</strong>
              {active?.opinion && <Badge tone={active.opinion.tone} dot>{active.opinion.label}</Badge>}
              <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
                {active?.meta?.basis} · {active?.meta?.fileName} ({fileSize(active?.meta?.fileSize)})
              </span>
            </div>

            {company.reports.length > 1 && (
              <div className="rep-scroll" role="group" aria-label="사업연도 선택">
                {company.reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`rep${r.id === active?.id ? ' active' : ''}`}
                    onClick={() => {
                      setActiveId(r.id)
                      setTab('summary')
                    }}
                  >
                    <span className="t">{r.meta?.fiscalYear ? `${r.meta.fiscalYear}년` : '연도 미확인'}</span>
                    <span className="m">
                      <span>{r.meta?.basis}</span>
                      <span>·</span>
                      <span>{r.opinion?.label || '의견 미확인'}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

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
              {tab === 'trend' && <TrendTab timeline={timeline} reports={company.reports} />}
              {tab === 'ratio' && <RatioTab report={mergedActive} timeline={timeline} />}
              {tab === 'notes' && <NotesTab report={mergedActive} notes={activeContent?.notes} loading={contentLoading} />}
              {tab === 'raw' && <RawTab report={mergedActive} rawText={activeContent?.rawText} loading={contentLoading} onDownload={downloadRaw} />}
            </div>

            <Callout>
              같은 회사의 다른 사업연도 감사보고서를 업로드하면 추이 그래프의 연도축이 자동으로 늘어납니다.
            </Callout>
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
