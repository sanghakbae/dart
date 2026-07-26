// 보고서 저장소. 로그인한 사용자만 쓰고, DB(Firestore) 가 유일한 저장소다.
//
//   companies/{companyKey}                                누적 요약 (연도별 값 · 최신 감사의견)
//   companies/{companyKey}/reports/{reportId}              보고서별 분석 결과
//   companies/{companyKey}/reports/{reportId}/content/*    원문 · 표 · 주석 청크
//
// reportId 는 연도·기간종류·연결여부로 결정되므로 같은 보고서를 다시 올리면
// 새 문서가 생기지 않고 갱신된다.

import { db, auth, isFirebaseConfigured } from '../firebase.js'
import {
  collection, doc, setDoc, getDoc, getDocs, query, orderBy, where, writeBatch, limit,
  runTransaction, updateDoc, deleteDoc,
} from 'firebase/firestore'
import { accumulateCompany, companyView, companyKeyOf, reportIdOf } from './company.js'
import { isAdmin } from './auth.js'

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

/** 누가 올렸는지. 공유 저장소라 목록에서 출처를 알 수 있어야 한다. */
function uploader() {
  const u = auth?.currentUser
  return u ? { uid: u.uid, email: u.email || null, name: u.displayName || null } : null
}

/** 목록·추이 계산에 쓰는 가벼운 요약(본문 제외) */
function toSummary(report) {
  const { rawText, blocks, notes, sections, ...rest } = report
  return sanitize({
    ...rest,
    uploadedBy: uploader(),
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
    return { mode: 'local', label: 'DB 설정 없음', hint: 'Firebase 설정이 없어 저장할 수 없습니다. .env 의 VITE_FIREBASE_* 를 확인해 주세요.' }
  }
  if (state === 'blocked') {
    return {
      mode: 'blocked',
      label: 'DB 저장 차단됨',
      hint: 'Firestore 보안 규칙이 접근을 막고 있습니다. `firebase deploy --only firestore:rules` 로 규칙을 배포해 주세요.',
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
    return '권한이 없습니다. 로그인 상태를 확인하고, 규칙이 배포됐는지 확인해 주세요 (`firebase deploy --only firestore:rules`).'
  }
  if (code === 'unavailable') return 'Firestore 에 연결할 수 없습니다. 네트워크를 확인해 주세요.'
  return `DB 작업 실패 (${code || e?.message || '원인 불명'})`
}

function keysOf(report) {
  return {
    companyKey: report.companyKey || companyKeyOf(report.meta?.company),
    reportId: report.id || reportIdOf(report.meta || {}),
  }
}

// ── 공개 API ──────────────────────────────────────────────────
/**
 * 보고서 저장. DB 가 유일한 저장소다.
 *
 * 예전에는 Firestore 가 막히면 IndexedDB 로 떨어뜨렸는데, 그 사본이 목록에 섞여
 * DB 에서 지운 회사가 계속 살아 있는 것처럼 보이는 문제를 만들었다.
 * 로그인을 붙인 뒤로는 폴백할 이유가 없어 실패를 그대로 올린다.
 *
 * @returns {{report:object, companyKey:string, storage:'firestore', warning:null}}
 */
export async function saveReport(report) {
  const { companyKey, reportId } = keysOf(report)
  const withKeys = { ...report, companyKey, id: reportId }

  if (!usesFirestore) {
    throw new Error('Firebase 설정이 없어 저장할 수 없습니다. .env 의 VITE_FIREBASE_* 값을 확인해 주세요.')
  }
  try {
    await saveToFirestore(withKeys, companyKey, reportId)
  } catch (e) {
    throw new Error(firestoreHint(e))
  }
  return { report: { ...withKeys, storage: 'firestore' }, companyKey, storage: 'firestore', warning: null }
}

/**
 * 회사 목록 (누적 문서 기준).
 *
 * 관리자는 전부 보고, 그 외에는 '내가 올린 것 + 관리자가 공통 노출로 지정한 것'만 본다.
 * 규칙이 조회 결과를 문서 단위로 검사하므로, 한 번에 훑지 않고 통과 조건에 맞춰
 * 쿼리를 둘로 나눠 던진다(하나라도 규칙에 걸리면 쿼리 전체가 실패한다).
 *
 * @returns {{companies:object[], warning:string|null, dbState:string}}
 */
export async function listCompanies() {
  let cloud = []
  let warning = null
  let dbState = usesFirestore ? 'db' : 'local'
  if (usesFirestore) {
    const user = auth?.currentUser
    try {
      const rows = []
      if (isAdmin(user)) {
        const snap = await getDocs(query(collection(db, COL), orderBy('updatedAt', 'desc'), limit(500)))
        rows.push(...snap.docs)
      } else {
        // where + limit 조합은 복합 색인이 필요 없다. 정렬은 아래에서 한다.
        const qs = [getDocs(query(collection(db, COL), where('shared', '==', true), limit(500)))]
        if (user) qs.push(getDocs(query(collection(db, COL), where('ownerUid', '==', user.uid), limit(500))))
        for (const snap of await Promise.all(qs)) rows.push(...snap.docs)
      }
      const byId = new Map()
      for (const d of rows) byId.set(d.id, { ...d.data(), key: d.id, storage: 'firestore' })
      cloud = [...byId.values()]
    } catch (e) {
      warning = firestoreHint(e)
      dbState = e?.code === 'permission-denied' ? 'blocked' : 'local'
    }
  }
  const companies = cloud
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
  const reports = cloud.sort(
    (a, b) =>
      (b.meta?.fiscalYear || 0) - (a.meta?.fiscalYear || 0) ||
      (PERIOD_RANK[b.meta?.periodType] ?? 0) - (PERIOD_RANK[a.meta?.periodType] ?? 0) ||
      (b.createdAt || 0) - (a.createdAt || 0)
  )
  return { reports, warning }
}

const PERIOD_RANK = { FY: 4, Q3: 3, H1: 2, Q1: 1 }

export async function loadContent(companyKey, reportId) {
  if (!usesFirestore) return null
  return loadContentFromFirestore(companyKey, reportId)
}

/**
 * 회사 하나를 통째로 지운다 — 본문 청크 → 보고서 → 회사 문서 순.
 * Firestore 클라이언트에는 재귀 삭제가 없어 아래에서 직접 훑는다.
 * 클라우드와 로컬 사본을 모두 지우고, 클라우드가 막혀도 로컬은 정리한다.
 * @returns {{deleted:{reports:number, chunks:number}, warning:string|null}}
 */
export async function deleteCompany(companyKey) {
  let warning = null
  const deleted = { reports: 0, chunks: 0 }

  if (usesFirestore) {
    // 회사 문서를 가장 먼저 지운다. 이게 권한 관문이다.
    //
    // 반대로 하면(본문 → 보고서 → 회사) 규칙이 본문 삭제만 허용하는 상태에서
    // 본문만 날아가고 목록에는 그대로 남는 사고가 난다. 실제로 그렇게 당했다.
    // 여기서 막히면 아무것도 건드리지 않은 채로 끝난다.
    try {
      await deleteDoc(companyDoc(companyKey))
    } catch (e) {
      return { deleted, warning: firestoreHint(e) }
    }

    // 관문을 통과했으면 하위도 같은 권한으로 지워진다. 중간에 실패해도
    // 회사 문서가 이미 없어 목록에는 안 보이므로, 남은 건 조용히 넘긴다.
    try {
      const reps = await getDocs(collection(db, COL, companyKey, 'reports'))
      for (const r of reps.docs) {
        const chunks = await getDocs(contentCol(companyKey, r.id))
        await commitAll(chunks.docs.map((d) => d.ref))
        deleted.chunks += chunks.size
      }
      await commitAll(reps.docs.map((d) => d.ref))
      deleted.reports = reps.size
    } catch (e) {
      warning = `회사는 삭제했지만 하위 문서 일부가 남았습니다: ${firestoreHint(e)}`
    }
  }

  return { deleted, warning }
}

/**
 * 공통 노출 지정/해제 — 관리자 전용(실제 차단은 규칙이 한다).
 * 켜면 로그인한 모든 계정의 목록에 나타나고, 끄면 올린 본인과 관리자만 본다.
 */
export async function setCompanyShared(companyKey, shared) {
  if (!usesFirestore) throw new Error('Firestore 를 쓰지 않는 환경입니다.')
  await updateDoc(companyDoc(companyKey), { shared: Boolean(shared), sharedAt: shared ? Date.now() : null })
}

/** 문서 참조 묶음을 400개씩 끊어 지운다(배치 한도 500). */
async function commitAll(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db)
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref)
    await batch.commit()
  }
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
    const next = accumulateCompany(snap.exists() ? snap.data() : null, report, uploader())
    txn.set(companyDoc(ck), sanitize({ ...next, storage: 'firestore' }))
  })

  // 정정보고서는 원본과 reportId 가 같아 서로를 덮는다. 정정본이 이겨야 하므로,
  // 이미 정정본이 저장돼 있는데 원본을 올리면 본문까지 되돌아가지 않게 건너뛴다.
  const prevRep = await getDoc(reportDoc(ck, rid))
  if (prevRep.exists() && prevRep.data()?.meta?.isAmendment && !report.meta?.isAmendment) {
    return { skipped: 'amendment-kept' }
  }

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

// ── 옛 로컬 사본 정리 ────────────────────────────────────────
// 예전에는 Firestore 가 막히면 IndexedDB 로 떨어뜨렸다. 그 사본이 목록에 섞여
// DB 에서 지운 회사가 살아 있는 것처럼 보였다. 이제 쓰지 않으므로 한 번 지운다.
const LEGACY_DB = 'dart-audit-analyzer'

export function dropLegacyLocalStore() {
  try {
    indexedDB?.deleteDatabase(LEGACY_DB)
  } catch {
    /* 지우지 못해도 읽는 곳이 없으니 문제되지 않는다 */
  }
}
