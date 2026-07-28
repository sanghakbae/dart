import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeFile } from './lib/parse'
import {
  saveReport, listCompanies, loadCompanyReports, loadContent, backendLabel,
  deleteCompany, setCompanyShared, dropLegacyLocalStore,
} from './lib/storage'
import { buildTimeline, splitByPeriodType } from './lib/analyze/series'
import { useAuth, signOut, authAvailable } from './lib/auth'
import { touchUser, bumpUpload } from './lib/usage'
import { prefetchExternals } from './lib/externals'
import { readRoute, writeRoute } from './lib/route'
import Header from './components/Header'
import SignIn from './components/SignIn'
import AdminPage from './components/AdminPage'
import UploadZone from './components/UploadZone'
import CompanyList from './components/CompanyList'
import ConfirmDelete from './components/ConfirmDelete'
import DartImport from './components/DartImport'
import { Card, Badge, Empty, Callout } from './components/ui'
import SummaryTab from './components/tabs/SummaryTab'
import OpinionTab from './components/tabs/OpinionTab'
import StatementsTab from './components/tabs/StatementsTab'
import TrendTab from './components/tabs/TrendTab'
import RatioTab from './components/tabs/RatioTab'
import ValuationTab from './components/tabs/ValuationTab'
import ChecklistTab from './components/tabs/ChecklistTab'
import EmploymentTab from './components/tabs/EmploymentTab'
import FundingTab from './components/tabs/FundingTab'
import PatentTab from './components/tabs/PatentTab'
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
  { key: 'employment', label: '고용' },
  { key: 'funding', label: '투자' },
  { key: 'patent', label: '특허' },
  { key: 'checklist', label: '점검' },
  { key: 'notes', label: '주석' },
  { key: 'raw', label: '원문' },
]

// 새로고침해도 보던 화면에 머문다(lib/route.js). 첫 렌더 전에 한 번 읽어 둔다.
const TAB_KEYS = TABS.map((t) => t.key)
const ROUTE0 = readRoute(typeof window === 'undefined' ? '' : window.location.hash, TAB_KEYS)

export default function App() {
  const [companies, setCompanies] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [companyKey, setCompanyKey] = useState(ROUTE0.companyKey)
  const [reports, setReports] = useState([]) // 선택한 회사의 보고서들
  const [loadingReports, setLoadingReports] = useState(false)
  const [activeId, setActiveId] = useState(ROUTE0.reportId)
  const [tab, setTab] = useState(ROUTE0.tab || 'summary')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState('')
  const [toasts, setToasts] = useState([])
  const [content, setContent] = useState({}) // `${companyKey}/${reportId}` → 본문
  const [contentLoading, setContentLoading] = useState(false)
  const [periodType, setPeriodType] = useState(null)
  const [basis, setBasis] = useState(null) // 추이에 쓸 연결/별도 기준
  const [theme, setTheme] = useState(() => localStorage.getItem('dart-theme') || 'auto')
  const contentReq = useRef(0)

  const { user, ready: authReady, admin } = useAuth()
  const [adminView, setAdminView] = useState(false)
  const [deletingKey, setDeletingKey] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [sharingKey, setSharingKey] = useState(null)

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

  // 로그인 전에는 목록을 부르지 않는다(규칙이 막아 permission-denied 만 뜬다).
  useEffect(() => {
    if (!authReady) return
    if (authAvailable && !user) {
      setCompanies([])
      setLoadingList(false)
      return
    }
    refreshCompanies()
  }, [authReady, user, refreshCompanies])

  // 로그인 기록 — 관리자 페이지의 이용 현황이 이걸로 만들어진다.
  useEffect(() => {
    if (user) touchUser(user)
  }, [user])

  // 옛 IndexedDB 사본 정리. 이제 DB만 쓰는데 그 사본이 목록에 섞여
  // 지운 회사가 살아 있는 것처럼 보이던 문제가 있었다.
  useEffect(() => {
    dropLegacyLocalStore()
  }, [])

  // 관리자가 아니게 되면 관리자 화면에 머물지 않는다.
  useEffect(() => {
    if (!admin) setAdminView(false)
  }, [admin])

  // 보고 있는 화면을 주소에 새겨 둔다. 새로고침하면 여기서 다시 시작한다.
  // 탭을 옮길 때마다 히스토리를 쌓지는 않는다(replaceState).
  useEffect(() => {
    const next = writeRoute({ companyKey, tab, reportId: activeId })
    if (window.location.hash !== next) window.history.replaceState(null, '', next)
  }, [companyKey, tab, activeId])

  // 주소에 있던 회사가 지워졌거나 볼 권한이 없으면 목록으로 돌린다.
  // (그대로 두면 "보고서를 찾지 못했습니다" 만 뜬 채 갇힌다)
  //
  // 로그인 전에는 목록이 비어 있는 게 정상이라 판단하지 않는다 — 여기서 지워 버리면
  // 로그인하고 돌아왔을 때 보던 회사가 아니라 목록으로 떨어진다.
  useEffect(() => {
    if (!authReady || (authAvailable && !user)) return
    if (loadingList || !companyKey) return
    if (!companies.some((c) => c.key === companyKey)) {
      setCompanyKey(null)
      setActiveId(null)
    }
  }, [authReady, user, loadingList, companies, companyKey])

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
      // 이번 업로드로 처음 생긴 회사들. 등록 직후 외부 자료를 한 번 받아 둔다.
      const known = new Set(companies.map((c) => c.key))
      const fresh = new Map()
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
          bumpUpload()

          setContent((prev) => ({
            ...prev,
            [`${ck}/${saved.id}`]: { rawText: report.rawText, blocks: report.blocks, notes: report.notes, sections: report.sections },
          }))
          lastCompany = ck
          if (!known.has(ck) && !fresh.has(ck)) {
            fresh.set(ck, { company: report.meta.company, bizNo: report.meta.bizNo || null })
          }

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

      // 새 회사는 고용·투자·특허를 미리 받아 둔다. 탭마다 '받아오기' 를 세 번
      // 누르게 하지 않으려는 것이고, 등록은 회사당 한 번뿐이라 한도에도 부담이 없다.
      // 업로드 흐름을 막지 않도록 뒤에서 돌리고, 실패해도 조용히 넘긴다.
      for (const [ck, info] of fresh) {
        toast(`${info.company} — 고용·투자·특허를 받아오는 중입니다`)
        prefetchExternals(ck, info)
          .then((got) => {
            const names = [
              got.employment && '고용',
              got.funding && '투자',
              got.patents && '특허',
            ].filter(Boolean)
            if (names.length) toast(`${info.company} — ${names.join('·')} 받아왔습니다`)
          })
          .catch(() => {})
      }
      if (lastCompany && !companyKey) setCompanyKey(null) // 목록에 머문다
    },
    [companyKey, companies, refreshCompanies, toast]
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

  // 확인 모달로 넘긴다. window.prompt 는 임베드 브라우저에서 차단돼 조용히 실패한다.
  const handleDelete = useCallback((c) => setPendingDelete(c), [])

  const confirmDelete = useCallback(async () => {
    const c = pendingDelete
    if (!c) return
    setDeletingKey(c.key)
    try {
      const { deleted, warning } = await deleteCompany(c.key)
      if (warning) {
        toast(warning, 'bad')
      } else {
        toast(`${c.name} 삭제 완료 — 보고서 ${deleted.reports}건, 본문 ${deleted.chunks}조각`)
        setPendingDelete(null)
      }
      if (companyKey === c.key) {
        setCompanyKey(null)
        setActiveId(null)
      }
      await refreshCompanies()
    } catch (e) {
      toast(`삭제하지 못했습니다: ${e.message}`, 'bad')
    } finally {
      setDeletingKey(null)
    }
  }, [pendingDelete, companyKey, refreshCompanies, toast])

  const handleShare = useCallback(
    async (c, next) => {
      setSharingKey(c.key)
      try {
        await setCompanyShared(c.key, next)
        toast(`${c.name} — ${next ? '모든 계정에 공개' : '비공개로 전환'}했습니다.`)
        await refreshCompanies()
      } catch (e) {
        toast(
          e?.code === 'permission-denied'
            ? '공통 노출은 관리자만 지정할 수 있습니다. firestore.rules 가 배포됐는지 확인해 주세요.'
            : `변경하지 못했습니다: ${e.message}`,
          'bad'
        )
      } finally {
        setSharingKey(null)
      }
    },
    [refreshCompanies, toast]
  )

  const selectCompany = useCallback((c) => {
    setCompanyKey(c.key)
    setActiveId(null)
    setPeriodType(null)
    setBasis(null)
    setTab('summary')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const closeCompany = useCallback(() => {
    setCompanyKey(null)
    setActiveId(null)
  }, [])

  // 추이는 같은 보고기간 종류끼리만 하나의 축에 올린다.
  const periodGroups = useMemo(() => splitByPeriodType(reports), [reports])
  // 고른 것이 없으면 지금 보고 있는 보고서의 보고기간 종류를 따른다.
  const activeGroup = useMemo(
    () =>
      periodGroups.find((g) => g.type === periodType) ||
      periodGroups.find((g) => g.type === (active?.meta?.periodType || 'FY')) ||
      periodGroups[0] ||
      null,
    [periodGroups, periodType, active]
  )
  /**
   * 연결과 별도는 합산 범위가 달라 한 축에 섞으면 비교가 성립하지 않는다.
   * 무하유처럼 2024년엔 별도만, 2025년엔 별도·연결이 함께 있는 경우가 흔하므로
   * 기준을 골라 볼 수 있게 하고, 기본값은 연도가 더 많이 쌓인 쪽으로 둔다.
   */
  const basisOptions = useMemo(() => {
    const rows = activeGroup?.reports || []
    const map = new Map()
    for (const r of rows) {
      const b = r.meta?.basis || '별도'
      map.set(b, (map.get(b) || 0) + 1)
    }
    const latestBasis = rows[0]?.meta?.basis
    return [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || (a.value === latestBasis ? -1 : 1))
  }, [activeGroup])

  const activeBasis = useMemo(() => {
    if (basisOptions.some((o) => o.value === basis)) return basis
    // 기본값은 지금 보고 있는 보고서의 기준. 연결감사보고서를 골랐는데 별도 추이가
    // 뜨면 한 화면에서 합산 범위가 다른 숫자를 같이 보게 된다.
    const own = active?.meta?.basis
    if (own && basisOptions.some((o) => o.value === own)) return own
    return basisOptions[0]?.value || null
  }, [basisOptions, basis, active])

  /**
   * 추이에 쓸 보고서 — 고른 보고서의 사업연도까지만 넣는다.
   *
   * 2024년 감사보고서를 골랐는데 2025년 숫자가 같이 뜨면, 화면에 보이는 감사의견·
   * 주석·원문(2024년)과 그래프·비율·기업가치(2025년 포함)가 서로 다른 시점을 말하게 된다.
   * 고른 보고서를 기준 시점으로 삼아 그 뒤 연도는 빼고, 그 전 연도는 그대로 누적한다.
   */
  const asOfYear = active?.meta?.fiscalYear ?? null
  const basisReports = useMemo(
    () => (activeGroup?.reports || []).filter((r) => !activeBasis || (r.meta?.basis || '별도') === activeBasis),
    [activeGroup, activeBasis]
  )
  const trendReports = useMemo(
    () => basisReports.filter((r) => asOfYear == null || (r.meta?.fiscalYear ?? asOfYear) <= asOfYear),
    [basisReports, asOfYear]
  )
  /** 기준 시점보다 뒤라서 뺀 보고서 — 조용히 감추지 않고 화면에 알린다. */
  const laterReports = useMemo(
    () => basisReports.filter((r) => asOfYear != null && (r.meta?.fiscalYear ?? asOfYear) > asOfYear),
    [basisReports, asOfYear]
  )

  const timeline = useMemo(
    () => buildTimeline(trendReports, { labelSuffix: activeGroup?.type === 'FY' ? '' : activeGroup?.label }),
    [trendReports, activeGroup]
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
        user={user}
        admin={admin}
        adminView={adminView}
        onAdmin={() => setAdminView((v) => !v)}
        onSignOut={signOut}
      />

      <main className="wrap stack-lg" style={{ paddingTop: 20 }}>
        {!authReady ? (
          <Card><Empty title="로그인 상태를 확인하는 중입니다…" /></Card>
        ) : authAvailable && !user ? (
          <SignIn configured={authAvailable} />
        ) : adminView ? (
          <AdminPage
            companies={companies}
            onBack={() => setAdminView(false)}
            onShare={handleShare}
            sharingKey={sharingKey}
          />
        ) : !companyKey ? (
          <>
            <UploadZone
              onFiles={handleFiles}
              onSample={companies.length ? undefined : loadSample}
              busy={busy}
              progress={progress}
              phase={phase}
              compact={companies.length > 0}
            />

            <Card title="DART 에서 가져오기" sub="회사명으로 찾아 공시 원문을 바로 받습니다">
              <DartImport onFiles={handleFiles} busy={busy} />
            </Card>

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
              <CompanyList
                companies={companies}
                activeKey={companyKey}
                onSelect={selectCompany}
                onDelete={handleDelete}
                deletingKey={deletingKey}
              />
            )}
          </>
        ) : (
          <>
            <div className="co-head">
              <button className="btn btn-back" type="button" onClick={closeCompany}>
                ‹ 회사 목록
              </button>
              <strong>{company?.name || companyKey}</strong>
              {active?.opinion && <Badge tone={active.opinion.tone} dot>{active.opinion.label}</Badge>}
              {active && (
                <span className="co-head-meta">
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
                  <div className="rep-groups">
                    {groupByBasis(reports).map(([groupBasis, list]) => (
                      <div className="rep-group" key={groupBasis}>
                        <span className="rep-group-label">
                          {groupBasis === '연결' ? '연결감사보고서' : '감사보고서 (별도)'}
                          <i>{list.length}건</i>
                        </span>
                        <div className="rep-scroll" role="group" aria-label={`${groupBasis} 보고기간 선택`}>
                          {list.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className={`rep${r.id === active.id ? ' active' : ''}`}
                        onClick={() => {
                          setActiveId(r.id)
                          setTab('summary')
                          // 기준 시점이 바뀌었으니 기준·보고기간 선택도 새 보고서를 따라가게 되돌린다.
                          setBasis(null)
                          setPeriodType(null)
                        }}
                      >
                        <span className="t">
                          {r.meta?.fiscalYear ? `${r.meta.fiscalYear}년` : '연도 미확인'}
                          {r.meta?.periodType && r.meta.periodType !== 'FY' ? ` ${r.meta.periodLabel}` : ''}
                        </span>
                        <span className="m">
                          <span>{r.meta?.docKind || '감사보고서'}</span>
                          <span>·</span>
                          <span>{r.opinion?.label || '의견 미확인'}</span>
                        </span>
                      </button>
                          ))}
                        </div>
                      </div>
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
                      reports={trendReports}
                      periodGroups={periodGroups}
                      periodType={activeGroup?.type}
                      onPeriodType={setPeriodType}
                      basisOptions={basisOptions}
                      basis={activeBasis}
                      onBasis={setBasis}
                      asOfYear={asOfYear}
                      laterReports={laterReports}
                    />
                  )}
                  {tab === 'ratio' && <RatioTab report={mergedActive} timeline={timeline} />}
                  {tab === 'valuation' && <ValuationTab report={mergedActive} timeline={timeline} />}
                  {tab === 'employment' && <EmploymentTab report={mergedActive} timeline={timeline} />}
                  {tab === 'funding' && <FundingTab report={mergedActive} />}
                  {tab === 'patent' && <PatentTab report={mergedActive} />}
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

      <ConfirmDelete
        company={pendingDelete}
        busy={deletingKey === pendingDelete?.key}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />

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

/** 보고서를 연결/별도로 묶는다. 별도를 먼저 보여준다(대개 연도가 더 길다). */
function groupByBasis(reports) {
  const map = new Map()
  for (const r of reports) {
    const b = r.meta?.basis || '별도'
    if (!map.has(b)) map.set(b, [])
    map.get(b).push(r)
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] === '별도' ? -1 : 1))
}

function summaryOf(report) {
  const { rawText, blocks, notes, sections, ...rest } = report
  return {
    ...rest,
    notesCount: notes?.count || 0,
    notesIndex: (notes?.items || []).map((n) => ({ no: n.no, title: n.title, page: n.page, length: n.body?.length || 0 })),
  }
}
