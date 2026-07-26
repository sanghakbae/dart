// 보고서 저장소. 로그인 없이 회사 단위로 누적한다.
//
//   companies/{companyKey}                                누적 요약 (연도별 값 · 최신 감사의견)
//   companies/{companyKey}/reports/{reportId}              보고서별 분석 결과
//   companies/{companyKey}/reports/{reportId}/content/*    원문 · 표 · 주석 청크
//
// reportId 는 연도·기간종류·연결여부로 결정되므로 같은 보고서를 다시 올리면
// 새 문서가 생기지 않고 갱신된다. Firestore 를 쓸 수 없으면 IndexedDB 로 폴백한다.

import { db, isFirebaseConfigured } from '../firebase.js'
import {
  collection, doc, setDoc, getDoc, getDocs, query, orderBy, writeBatch, limit, runTransaction,
} from 'firebase/firestore'
import { accumulateCompany, companyView, companyKeyOf, reportIdOf } from './company.js'

const CHUNK = 400_000 // Firestore 문서 1MB 한도 대비 여유 있게
const COL = 'companies'

/**
 * Firestore 는 undefined 와 '배열 안의 배열' 을 거부한다(invalid-argument).
 * 저장 직전에 한 번 걸러 준다 — 중첩 배열은 JSON 문자열로 눕힌다.
 */
function sanitize(value, depth = 0, inArray = false) {
  if (value === undefined) return undefined
  if (value === null) return null
  if (Array.isArray(value)) {
    if (inArray) return JSON.stringify(value) // 배열 안의 배열
    return value.map((v) => sanitize(v, depth + 1, true)).filter((v) => v !== undefined)
  }
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const s = sanitize(v, depth + 1, false)
      if (s !== undefined) out[k] = s
    }
    return out
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null
  return value
}

/** 목록·추이 계산에 쓰는 가벼운 요약(본문 제외) */
function toSummary(report) {
  const { rawText, blocks, notes, sections, ...rest } = report
  return sanitize({
    ...rest,
    notesIndex: (notes?.items || []).map((n) => ({ no: n.no, title: n.title, page: n.page, length: n.body?.length || 0 })),
    notesCount: notes?.count || 0,
    notesFound: Boolean(notes?.found),
    sectionsIndex: (sections || []).map((s) => ({ key: s.key, label: s.label, length: s.text?.length || 0 })),
    hasContent: true,
  })
}

function contentParts(report) {
  return [
    { kind: 'raw', text: report.rawText || '' },
    { kind: 'blocks', text: JSON.stringify(report.blocks || []) },
    { kind: 'notes', text: JSON.stringify(report.notes || { items: [] }) },
    { kind: 'sections', text: JSON.stringify(report.sections || []) },
  ]
}

function chunkify(parts) {
  const out = []
  for (const p of parts) {
    const total = Math.max(1, Math.ceil(p.text.length / CHUNK))
    for (let i = 0; i < total; i++) {
      out.push({ id: `${p.kind}-${String(i).padStart(3, '0')}`, kind: p.kind, seq: i, total, text: p.text.slice(i * CHUNK, (i + 1) * CHUNK) })
    }
  }
  return out
}

function reassemble(chunks) {
  const byKind = {}
  for (const c of chunks) {
    byKind[c.kind] = byKind[c.kind] || []
    byKind[c.kind].push(c)
  }
  const join = (kind) => (byKind[kind] || []).sort((a, b) => a.seq - b.seq).map((c) => c.text).join('')
  const safeParse = (s, fallback) => {
    if (!s) return fallback
    try {
      return JSON.parse(s)
    } catch {
      return fallback
    }
  }
  return {
    rawText: join('raw'),
    blocks: safeParse(join('blocks'), []),
    notes: safeParse(join('notes'), { found: false, count: 0, items: [] }),
    sections: safeParse(join('sections'), []),
  }
}

export const usesFirestore = Boolean(isFirebaseConfigured && db)

/**
 * 실제 쓰기 가능 여부까지 반영한 저장 상태.
 * 설정이 붙어 있어도 규칙이 막고 있으면 DB에 안 들어가므로, 그 차이를 화면에 그대로 드러낸다.
 *   'checking' → 아직 확인 전, 'db' → 실제 DB 누적, 'blocked' → 규칙이 막음, 'local' → 설정 없음
 */
export function backendLabel(state) {
  if (!usesFirestore) {
    return { mode: 'local', label: '브라우저 저장', hint: 'Firebase 설정이 없어 이 브라우저에만 저장합니다.' }
  }
  if (state === 'blocked') {
    return {
      mode: 'blocked',
      label: 'DB 저장 차단됨',
      hint: 'Firestore 보안 규칙이 접근을 막고 있어 이 브라우저에만 저장됩니다. `firebase deploy --only firestore:rules` 로 규칙을 배포해 주세요.',
    }
  }
  if (state === 'db') {
    return { mode: 'firestore', label: 'DB 저장', hint: '업로드한 감사보고서 전체 내용이 회사별로 Firestore에 누적됩니다.' }
  }
  return { mode: 'checking', label: 'DB 연결 확인 중', hint: 'Firestore 접근 가능 여부를 확인하고 있습니다.' }
}

/** Firestore 실패 원인을 사용자에게 그대로 보여줄 문구로 바꾼다. */
function firestoreHint(e) {
  const code = e?.code || ''
  if (code === 'permission-denied') {
    return 'Firestore 보안 규칙이 접근을 막고 있습니다. `firebase deploy --only firestore:rules` 로 규칙을 배포해 주세요. 지금은 브라우저에만 저장했습니다.'
  }
  if (code === 'unavailable') return 'Firestore 에 연결할 수 없어 브라우저에만 저장했습니다.'
  return `Firestore 저장 실패 (${code || e?.message || '원인 불명'}) — 브라우저에만 저장했습니다.`
}

function keysOf(report) {
  return {
    companyKey: report.companyKey || companyKeyOf(report.meta?.company),
    reportId: report.id || reportIdOf(report.meta || {}),
  }
}

// ── 공개 API ──────────────────────────────────────────────────
/** @returns {{report:object, companyKey:string, storage:'firestore'|'local', warning:string|null}} */
export async function saveReport(report) {
  const { companyKey, reportId } = keysOf(report)
  const withKeys = { ...report, companyKey, id: reportId }

  if (usesFirestore) {
    try {
      await saveToFirestore(withKeys, companyKey, reportId)
      await saveToLocal(withKeys, companyKey, reportId).catch(() => {})
      return { report: { ...withKeys, storage: 'firestore' }, companyKey, storage: 'firestore', warning: null }
    } catch (e) {
      await saveToLocal(withKeys, companyKey, reportId)
      return {
        report: { ...withKeys, storage: 'local' },
        companyKey,
        storage: 'local',
        warning: firestoreHint(e),
        dbState: e?.code === 'permission-denied' ? 'blocked' : 'local',
      }
    }
  }
  await saveToLocal(withKeys, companyKey, reportId)
  return { report: { ...withKeys, storage: 'local' }, companyKey, storage: 'local', warning: null }
}

/** 회사 목록 (누적 문서 기준) @returns {{companies:object[], warning:string|null, dbState:string}} */
export async function listCompanies() {
  let cloud = []
  let warning = null
  let dbState = usesFirestore ? 'db' : 'local'
  if (usesFirestore) {
    try {
      const snap = await getDocs(query(collection(db, COL), orderBy('updatedAt', 'desc'), limit(500)))
      cloud = snap.docs.map((d) => ({ ...d.data(), key: d.id, storage: 'firestore' }))
    } catch (e) {
      warning = firestoreHint(e)
      dbState = e?.code === 'permission-denied' ? 'blocked' : 'local'
    }
  }
  const local = await listLocalCompanies()
  const byKey = new Map()
  for (const c of [...cloud, ...local]) {
    const prev = byKey.get(c.key)
    if (!prev || (c.updatedAt || 0) > (prev.updatedAt || 0)) byKey.set(c.key, c)
  }
  const merged = [...byKey.values()]
  const companies = merged
    .map((c) => companyView(c))
    .sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0))
  return { companies, warning, dbState }
}

/** 특정 회사의 보고서 요약 목록 */
export async function loadCompanyReports(companyKey) {
  let cloud = []
  let warning = null
  if (usesFirestore) {
    try {
      const snap = await getDocs(collection(db, COL, companyKey, 'reports'))
      cloud = snap.docs.map((d) => ({ ...d.data(), id: d.id, companyKey, storage: 'firestore' }))
    } catch (e) {
      warning = firestoreHint(e)
    }
  }
  const local = await listLocalReports(companyKey)
  // 같은 보고서가 양쪽에 있으면 더 나중에 저장된 쪽을 쓴다.
  // (클라우드 쓰기가 막혀 로컬에만 최신본이 남는 경우가 있다)
  const merged = new Map()
  for (const r of [...cloud, ...local]) {
    const prev = merged.get(r.id)
    if (!prev || (r.storedAt || 0) > (prev.storedAt || 0)) merged.set(r.id, r)
  }
  const reports = [...merged.values()].sort(
    (a, b) =>
      (b.meta?.fiscalYear || 0) - (a.meta?.fiscalYear || 0) ||
      (PERIOD_RANK[b.meta?.periodType] ?? 0) - (PERIOD_RANK[a.meta?.periodType] ?? 0) ||
      (b.createdAt || 0) - (a.createdAt || 0)
  )
  return { reports, warning }
}

const PERIOD_RANK = { FY: 4, Q3: 3, H1: 2, Q1: 1 }

export async function loadContent(companyKey, reportId) {
  if (usesFirestore) {
    try {
      const fromCloud = await loadContentFromFirestore(companyKey, reportId)
      if (fromCloud) return fromCloud
    } catch {
      // 규칙·네트워크 문제면 로컬 사본으로 대체한다.
    }
  }
  return loadContentFromLocal(companyKey, reportId)
}

// ── Firestore ────────────────────────────────────────────────
const companyDoc = (ck) => doc(db, COL, ck)
const reportDoc = (ck, rid) => doc(db, COL, ck, 'reports', rid)
const contentCol = (ck, rid) => collection(db, COL, ck, 'reports', rid, 'content')

async function saveToFirestore(report, ck, rid) {
  // 회사 문서는 읽고-병합-쓰기라 트랜잭션으로 처리한다.
  // (같은 연도를 '당기'로 보고한 값이 '전기' 비교치를 덮어써야 하므로 merge 만으론 부족하다)
  await runTransaction(db, async (txn) => {
    const snap = await txn.get(companyDoc(ck))
    const next = accumulateCompany(snap.exists() ? snap.data() : null, report)
    txn.set(companyDoc(ck), sanitize({ ...next, storage: 'firestore' }))
  })

  await setDoc(reportDoc(ck, rid), { ...toSummary(report), storedAt: Date.now(), storage: 'firestore' })

  const chunks = chunkify(contentParts(report))
  const prev = await getDocs(contentCol(ck, rid))
  let batch = writeBatch(db)
  let ops = 0
  const flush = async () => {
    if (ops) await batch.commit()
    batch = writeBatch(db)
    ops = 0
  }
  for (const d of prev.docs) {
    batch.delete(d.ref)
    if (++ops >= 400) await flush()
  }
  for (const c of chunks) {
    batch.set(doc(contentCol(ck, rid), c.id), c)
    if (++ops >= 400) await flush()
  }
  await flush()
}

async function loadContentFromFirestore(ck, rid) {
  const head = await getDoc(reportDoc(ck, rid))
  if (!head.exists()) return null
  const snap = await getDocs(contentCol(ck, rid))
  if (snap.empty) return null
  return reassemble(snap.docs.map((d) => d.data()))
}

// ── IndexedDB (폴백) ─────────────────────────────────────────
const DB_NAME = 'dart-audit-analyzer'
// v3: 누적 키에 연결/별도를 포함하도록 바뀌어, 옛 키가 섞인 회사 문서를 버린다.
const DB_VERSION = 3
let dbp = null

function idb() {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      // 구버전 스토어는 버리고 다시 만든다(원본 파일을 다시 올리면 복구된다).
      for (const name of ['summaries', 'contents', 'companies', 'reports']) {
        if (d.objectStoreNames.contains(name)) d.deleteObjectStore(name)
      }
      d.createObjectStore('companies', { keyPath: 'key' })
      const reports = d.createObjectStore('reports', { keyPath: 'localId' })
      reports.createIndex('companyKey', 'companyKey', { unique: false })
      d.createObjectStore('contents', { keyPath: 'localId' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx(store, mode, fn) {
  return idb().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(store, mode)
        const s = t.objectStore(store)
        let result
        try {
          result = fn(s)
        } catch (e) {
          reject(e)
          return
        }
        t.oncomplete = () => resolve(result?.result !== undefined ? result.result : result)
        t.onerror = () => reject(t.error)
        t.onabort = () => reject(t.error)
      })
  )
}

const localId = (ck, rid) => `${ck}::${rid}`

async function saveToLocal(report, ck, rid) {
  const prev = await tx('companies', 'readonly', (s) => s.get(ck)).catch(() => null)
  const next = accumulateCompany(prev || null, report)
  await tx('companies', 'readwrite', (s) => s.put({ ...next, storage: 'local' }))
  await tx('reports', 'readwrite', (s) =>
    s.put({ ...toSummary(report), localId: localId(ck, rid), id: rid, companyKey: ck, storage: 'local', storedAt: Date.now() })
  )
  await tx('contents', 'readwrite', (s) =>
    s.put({
      localId: localId(ck, rid),
      rawText: report.rawText || '',
      blocks: report.blocks || [],
      notes: report.notes || { items: [] },
      sections: report.sections || [],
    })
  )
}

async function listLocalCompanies() {
  try {
    return (await tx('companies', 'readonly', (s) => s.getAll())) || []
  } catch {
    return []
  }
}

async function listLocalReports(ck) {
  try {
    const all = (await tx('reports', 'readonly', (s) => s.getAll())) || []
    return all.filter((r) => r.companyKey === ck)
  } catch {
    return []
  }
}

async function loadContentFromLocal(ck, rid) {
  try {
    const rec = await tx('contents', 'readonly', (s) => s.get(localId(ck, rid)))
    if (!rec) return null
    return { rawText: rec.rawText, blocks: rec.blocks, notes: rec.notes, sections: rec.sections }
  } catch {
    return null
  }
}
