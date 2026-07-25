// 보고서 저장소.
//   Firestore 설정 + 로그인 → users/{uid}/reports (본문은 content 서브컬렉션에 청크 저장)
//   그 외                    → 브라우저 IndexedDB
// 어느 경로든 "업로드한 감사보고서의 모든 내용"이 원문 그대로 남는다.

import { db, isFirebaseConfigured } from '../firebase.js'
import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc, query, orderBy, writeBatch, limit,
} from 'firebase/firestore'

const CHUNK = 400_000 // Firestore 문서 1MB 한도 대비 여유 있게

/** 목록·추이 계산에 쓰는 가벼운 요약(본문 제외) */
function toSummary(report) {
  const { rawText, blocks, notes, sections, ...rest } = report
  return {
    ...rest,
    notesIndex: (notes?.items || []).map((n) => ({ no: n.no, title: n.title, page: n.page, length: n.body?.length || 0 })),
    notesCount: notes?.count || 0,
    notesFound: Boolean(notes?.found),
    sectionsIndex: (sections || []).map((s) => ({ key: s.key, label: s.label, length: s.text?.length || 0 })),
    hasContent: true,
  }
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

// ── 백엔드 선택 ────────────────────────────────────────────────
export function backendFor(uid) {
  return isFirebaseConfigured && db && uid ? 'firestore' : 'local'
}

export function backendLabel(uid) {
  if (!isFirebaseConfigured) return { mode: 'local', label: '브라우저 저장', hint: 'Firebase 설정(.env)이 없어 이 브라우저에만 저장합니다.' }
  if (!uid) return { mode: 'local', label: '브라우저 저장', hint: '로그인하면 Firestore에 저장되어 다른 기기에서도 보입니다.' }
  return { mode: 'firestore', label: 'Firestore 저장', hint: '업로드한 보고서 전체 내용이 DB에 저장됩니다.' }
}

// ── 공개 API ──────────────────────────────────────────────────
export async function saveReport(report, uid) {
  if (backendFor(uid) === 'firestore') return saveToFirestore(report, uid)
  return saveToLocal(report)
}

export async function listReports(uid) {
  const cloud = backendFor(uid) === 'firestore' ? await listFromFirestore(uid) : []
  const local = await listFromLocal()
  const seen = new Set(cloud.map((r) => r.id))
  return [...cloud, ...local.filter((r) => !seen.has(r.id))].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}

export async function loadContent(id, uid, where) {
  if (where === 'firestore' || (where == null && backendFor(uid) === 'firestore')) {
    const fromCloud = await loadContentFromFirestore(id, uid)
    if (fromCloud) return fromCloud
  }
  return loadContentFromLocal(id)
}

export async function deleteReport(id, uid) {
  await deleteFromLocal(id)
  if (backendFor(uid) === 'firestore') await deleteFromFirestore(id, uid)
}

// ── Firestore ────────────────────────────────────────────────
const repCol = (uid) => collection(db, 'users', uid, 'reports')

async function saveToFirestore(report, uid) {
  const summary = toSummary(report)
  await setDoc(doc(repCol(uid), report.id), { ...summary, storedAt: Date.now(), storage: 'firestore' })

  const chunks = chunkify(contentParts(report))
  // 이전 본문이 남아 있으면 지우고 새로 쓴다.
  const prev = await getDocs(collection(repCol(uid), report.id, 'content'))
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
    batch.set(doc(collection(repCol(uid), report.id, 'content'), c.id), c)
    if (++ops >= 400) await flush()
  }
  await flush()

  // 로컬에도 사본을 남겨 오프라인에서 바로 열리게 한다.
  await saveToLocal(report).catch(() => {})
  return { ...report, storage: 'firestore' }
}

async function listFromFirestore(uid) {
  const snap = await getDocs(query(repCol(uid), orderBy('createdAt', 'desc'), limit(500)))
  return snap.docs.map((d) => ({ ...d.data(), id: d.id, storage: 'firestore' }))
}

async function loadContentFromFirestore(id, uid) {
  const head = await getDoc(doc(repCol(uid), id))
  if (!head.exists()) return null
  const snap = await getDocs(collection(repCol(uid), id, 'content'))
  if (snap.empty) return null
  return reassemble(snap.docs.map((d) => d.data()))
}

async function deleteFromFirestore(id, uid) {
  const snap = await getDocs(collection(repCol(uid), id, 'content'))
  const batch = writeBatch(db)
  snap.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(repCol(uid), id))
  await batch.commit()
}

// ── IndexedDB (로컬 폴백) ─────────────────────────────────────
const DB_NAME = 'dart-audit-analyzer'
const DB_VERSION = 1
let dbp = null

function idb() {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('summaries')) d.createObjectStore('summaries', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('contents')) d.createObjectStore('contents', { keyPath: 'id' })
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

async function saveToLocal(report) {
  await tx('summaries', 'readwrite', (s) => s.put({ ...toSummary(report), storage: 'local', storedAt: Date.now() }))
  await tx('contents', 'readwrite', (s) =>
    s.put({
      id: report.id,
      rawText: report.rawText || '',
      blocks: report.blocks || [],
      notes: report.notes || { items: [] },
      sections: report.sections || [],
    })
  )
  return { ...report, storage: 'local' }
}

async function listFromLocal() {
  try {
    const all = await tx('summaries', 'readonly', (s) => s.getAll())
    return all || []
  } catch {
    return []
  }
}

async function loadContentFromLocal(id) {
  try {
    const rec = await tx('contents', 'readonly', (s) => s.get(id))
    if (!rec) return null
    return { rawText: rec.rawText, blocks: rec.blocks, notes: rec.notes, sections: rec.sections }
  } catch {
    return null
  }
}

async function deleteFromLocal(id) {
  await tx('summaries', 'readwrite', (s) => s.delete(id)).catch(() => {})
  await tx('contents', 'readwrite', (s) => s.delete(id)).catch(() => {})
}
