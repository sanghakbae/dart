import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeFile } from './lib/parse'
import { saveReport, listCompanies, loadCompanyReports, loadContent, backendLabel } from './lib/storage'
import { buildTimeline, splitByPeriodType } from './lib/analyze/series'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import CompanyList from './components/CompanyList'
import { Card, Badge, Empty, Callout } from './components/ui'
import SummaryTab from './components/tabs/SummaryTab'
import OpinionTab from './components/tabs/OpinionTab'
import StatementsTab from './components/tabs/StatementsTab'
import TrendTab from './components/tabs/TrendTab'
import RatioTab from './components/tabs/RatioTab'
import ValuationTab from './components/tabs/ValuationTab'
import ChecklistTab from './components/tabs/ChecklistTab'
import NotesTab from './components/tabs/NotesTab'
import RawTab from './components/tabs/RawTab'
import { fileSize } from './lib/format'

const TABS = [
  { key: 'summary', label: '요약' },
  { key: 'opinion', label: '감사의견' },
  { key: 'statements', label: '재무제표' },
  { key: 'trend', label: '추이' },
  { key: 'ratio', label: '재무비율' },
  { key: 'valuation', label: '기업가치' },
  { key: 'checklist', label: '점검' },
  { key: 'notes', label: '주석' },
  { key: 'raw', label: '원문' },
]

export default function App() {
  const [companies, setCompanies] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [companyKey, setCompanyKey] = useState(null)
  const [reports, setReports] = useState([]) // 선택한 회사의 보고서들
  const [loadingReports, setLoadingReports] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [tab, setTab] = useState('summary')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [toasts, setToasts] = useState([])
  const [content, setContent] = useState({}) // `${companyKey}/${reportId}` → 본문
  const [contentLoading, setContentLoading] = useState(false)
  const [periodType, setPeriodType] = useState(null)
  const [theme, setTheme] = useState(() => localStorage.getItem('dart-theme') || 'auto')
  const contentReq = useRef(0)

  const [dbState, setDbState] = useState('checking')
  const storage = backendLabel(dbState)

  const toast = useCallback((text, tone) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 9000 : 5000)
  }, [])

  useEffect(() => {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('dart-theme', theme)
  }, [theme])

  // 회사 목록 (누적 문서 기준)
  const refreshCompanies = useCallback(async () => {
    try {
      const { companies: list, warning, dbState: state } = await listCompanies()
      setCompanies(list)
      setDbState(state)
      if (warning) toast(warning, 'warn')
    } catch (e) {
      toast(`회사 목록을 불러오지 못했습니다: ${e.message}`, 'bad')
    } finally {
      setLoadingList(false)
    }
  }, [toast])

  useEffect(() => {
    refreshCompanies()
  }, [refreshCompanies])

  const company = useMemo(() => companies.find((c) => c.key === companyKey) || null, [companies, companyKey])

  // 회사를 선택하면 그 회사의 보고서들을 불러온다.
  useEffect(() => {
    if (!companyKey) {
      setReports([])
      return
    }
    let alive = true
    setLoadingReports(true)
    loadCompanyReports(companyKey)
      .then(({ reports: list, warning }) => {
        if (!alive) return
        setReports(list)
        setActiveId((cur) => (list.some((r) => r.id === cur) ? cur : list[0]?.id || null))
        if (warning) toast(warning, 'warn')
      })
      .catch((e) => alive && toast(`보고서를 불러오지 못했습니다: ${e.message}`, 'bad'))
      .finally(() => alive && setLoadingReports(false))
    return () => {
      alive = false
    }
  }, [companyKey, toast])

  const active = useMemo(() => reports.find((r) => r.id === activeId) || reports[0] || null, [reports, activeId])
  const contentKey = active ? `${companyKey}/${active.id}` : null

  // 본문(원문·표·주석) 지연 로드
  useEffect(() => {
    if (!active || !contentKey || content[contentKey]) return
    const seq = ++contentReq.current
    setContentLoading(true)
    loadContent(companyKey, active.id)
      .then((c) => {
        if (seq !== contentReq.current) return
        setContent((prev) => ({ ...prev, [contentKey]: c || { rawText: '', blocks: [], notes: { items: [] }, sections: [] } }))
      })
      .catch(() => {
        if (seq === contentReq.current) toast('저장된 본문을 불러오지 못했습니다.', 'bad')
      })
      .finally(() => {
        if (seq === contentReq.current) setContentLoading(false)
      })
  }, [active, contentKey, companyKey, content, toast])

  const handleFiles = useCallback(
    async (files) => {
      setBusy(true)
      let lastCompany = null
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
          setPhase(`${file.name} DB에 누적 중`)
          const { report: saved, companyKey: ck, storage: where, warning, dbState: state } = await saveReport(report)
          if (state) setDbState(state)

          setContent((prev) => ({
            ...prev,
            [`${ck}/${saved.id}`]: { rawText: report.rawText, blocks: report.blocks, notes: report.notes, sections: report.sections },
          }))
          lastCompany = ck

          // 열려 있는 회사라면 보고서 목록도 즉시 갱신한다.
          setReports((prev) => (ck === companyKey ? [summaryOf(saved), ...prev.filter((r) => r.id !== saved.id)] : prev))

          const year = report.meta.fiscalYear ? `${report.meta.fiscalYear}년` : '연도 미확인'
          const period = report.meta.periodType && report.meta.periodType !== 'FY' ? ` ${report.meta.periodLabel}` : ''
          const warn = report.quality?.warnings?.length
          toast(
            `${report.meta.company} ${year}${period} ${where === 'firestore' ? 'DB에 누적했습니다' : '브라우저에 저장했습니다'}${warn ? ` (확인 필요 ${warn}건)` : ''}`,
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
      await refreshCompanies()
      if (lastCompany && !companyKey) setCompanyKey(null) // 목록에 머문다
    },
    [companyKey, refreshCompanies, toast]
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
    setActiveId(null)
    setPeriodType(null)
    setTab('summary')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const closeCompany = useCallback(() => {
    setCompanyKey(null)
    setActiveId(null)
  }, [])

  // 추이는 같은 보고기간 종류끼리만 하나의 축에 올린다.
  const periodGroups = useMemo(() => splitByPeriodType(reports), [reports])
  const activeGroup = useMemo(
    () => periodGroups.find((g) => g.type === periodType) || periodGroups[0] || null,
    [periodGroups, periodType]
  )
  const timeline = useMemo(
    () => buildTimeline(activeGroup ? activeGroup.reports : [], { labelSuffix: activeGroup?.type === 'FY' ? '' : activeGroup?.label }),
    [activeGroup]
  )

  const activeContent = contentKey ? content[contentKey] : null
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
        {!companyKey ? (
          <>
            <UploadZone
              onFiles={handleFiles}
              onSample={companies.length ? undefined : loadSample}
              busy={busy}
              progress={progress}
              phase={phase}
              compact={companies.length > 0}
            />

            {dbState === 'blocked' && (
              <Callout tone="warn">
                <span>
                  <strong>DB 저장이 차단된 상태입니다.</strong> Firestore 보안 규칙이 배포되지 않아 업로드한 보고서가
                  이 브라우저에만 저장되고 다른 사람에게는 보이지 않습니다.
                  <br />
                  <code>firebase deploy --only firestore:rules --project dart-40a5c</code> 를 실행하면 해결됩니다.
                </span>
              </Callout>
            )}

            {loadingList ? (
              <Card><Empty title="DB에서 회사 목록을 불러오는 중입니다…" /></Card>
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
              <strong style={{ fontSize: 17 }}>{company?.name || companyKey}</strong>
              {active?.opinion && <Badge tone={active.opinion.tone} dot>{active.opinion.label}</Badge>}
              {active && (
                <span style={{ color: 'var(--text-3)', fontSize: 13 }}>
                  {active.meta?.basis} · {active.meta?.docKind} · {active.meta?.fileName} ({fileSize(active.meta?.fileSize)})
                </span>
              )}
            </div>

            {loadingReports && !reports.length ? (
              <Card><Empty title="보고서를 불러오는 중입니다…" /></Card>
            ) : !active ? (
              <Card><Empty title="이 회사의 보고서를 찾지 못했습니다">보고서를 다시 업로드해 주세요.</Empty></Card>
            ) : (
              <>
                {reports.length > 1 && (
                  <div className="rep-scroll" role="group" aria-label="보고기간 선택">
                    {reports.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`rep${r.id === active.id ? ' active' : ''}`}
                        onClick={() => {
                          setActiveId(r.id)
                          setTab('summary')
                        }}
                      >
                        <span className="t">
                          {r.meta?.fiscalYear ? `${r.meta.fiscalYear}년` : '연도 미확인'}
                          {r.meta?.periodType && r.meta.periodType !== 'FY' ? ` ${r.meta.periodLabel}` : ''}
                        </span>
                        <span className="m">
                          <span>{r.meta?.basis}</span>
                          <span>·</span>
                          <span>{r.meta?.docKind || '감사보고서'}</span>
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
                  {tab === 'trend' && (
                    <TrendTab
                      timeline={timeline}
                      reports={activeGroup?.reports || []}
                      periodGroups={periodGroups}
                      periodType={activeGroup?.type}
                      onPeriodType={setPeriodType}
                    />
                  )}
                  {tab === 'ratio' && <RatioTab report={mergedActive} timeline={timeline} />}
                  {tab === 'valuation' && <ValuationTab report={mergedActive} timeline={timeline} />}
                  {tab === 'checklist' && (
                    <ChecklistTab report={mergedActive} timeline={timeline} notes={activeContent?.notes} loading={contentLoading} />
                  )}
                  {tab === 'notes' && <NotesTab report={mergedActive} notes={activeContent?.notes} loading={contentLoading} />}
                  {tab === 'raw' && <RawTab report={mergedActive} rawText={activeContent?.rawText} loading={contentLoading} onDownload={downloadRaw} />}
                </div>

                <UploadZone onFiles={handleFiles} busy={busy} progress={progress} phase={phase} compact />
                <Callout>
                  이 회사의 다른 사업연도 보고서를 업로드하면 같은 회사 문서에 <strong>연도 기준으로 누적</strong>되고
                  추이 그래프의 연도축이 늘어납니다.
                </Callout>
              </>
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
