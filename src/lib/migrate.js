// 잘못 갈린 회사 문서를 다시 묶는다.
//
// 회사명 파서가 표지 형식을 못 읽던 시절에는 파일명 전체를 회사명으로 썼다.
// 그래서 "[알체라]분기보고서(2026.05.15)" 같은 이름이 회사 하나로 잡히고,
// 같은 회사의 보고서가 파일 수만큼 쪼개졌다.
//
// 저장된 원문(rawText)을 고쳐진 파서로 다시 읽어 올바른 회사명을 구하고,
// 보고서와 본문 청크를 그 회사 밑으로 옮긴 뒤 빈 껍데기를 지운다.
// 원문 파일을 다시 올릴 필요가 없다.

import { db } from '../firebase.js'
import { collection, doc, getDocs, setDoc, writeBatch, runTransaction } from 'firebase/firestore'
import { resolveCompanyName } from './parse/meta.js'
import { accumulateCompany, companyKeyOf, displayCompany } from './company.js'
import { loadContent } from './storage.js'

const COL = 'companies'

/**
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{moved:number, removed:string[], groups:object[], skipped:number}>}
 */
export async function regroupCompanies(onProgress) {
  if (!db) throw new Error('Firestore 를 쓰지 않는 환경입니다.')
  const log = (m) => onProgress?.(m)

  log('회사 목록을 읽는 중…')
  const companySnap = await getDocs(collection(db, COL))

  // 1) 모든 보고서를 훑어 올바른 회사키를 다시 구한다.
  const plan = new Map() // 새 키 → { name, items: [{oldKey, reportId, data}] }
  let skipped = 0

  for (const cdoc of companySnap.docs) {
    const oldKey = cdoc.id
    const reps = await getDocs(collection(db, COL, oldKey, 'reports'))
    for (const r of reps.docs) {
      const data = r.data()
      // 원문에서 다시 판정한다. 원문이 없으면 파일명만으로라도 시도한다.
      let raw = ''
      try {
        raw = (await loadContent(oldKey, r.id))?.rawText || ''
      } catch {
        /* 본문이 없어도 파일명으로 판정할 수 있다 */
      }
      const resolved = resolveCompanyName(raw, data?.meta?.fileName)
      const newKey = companyKeyOf(resolved)
      if (!newKey) {
        skipped++
        continue
      }
      const g = plan.get(newKey) || { name: displayCompany(resolved), items: [] }
      g.items.push({ oldKey, reportId: r.id, data, resolvedName: resolved })
      plan.set(newKey, g)
    }
  }

  // 2) 이동이 필요한 것만 남긴다.
  const groups = []
  for (const [newKey, g] of plan) {
    const moving = g.items.filter((it) => it.oldKey !== newKey)
    if (moving.length) groups.push({ newKey, name: g.name, items: g.items, moving })
  }

  if (!groups.length) return { moved: 0, removed: [], groups: [], skipped }

  // 3) 실제 이동.
  let moved = 0
  const removed = new Set()

  for (const g of groups) {
    log(`${g.name} — 보고서 ${g.moving.length}건 이동 중…`)

    for (const it of g.moving) {
      // 본문 청크를 먼저 새 위치로 복사한다(원문을 잃지 않는 순서).
      const chunks = await getDocs(collection(db, COL, it.oldKey, 'reports', it.reportId, 'content'))
      let batch = writeBatch(db)
      let ops = 0
      for (const c of chunks.docs) {
        batch.set(doc(db, COL, g.newKey, 'reports', it.reportId, 'content', c.id), c.data())
        if (++ops >= 400) {
          await batch.commit()
          batch = writeBatch(db)
          ops = 0
        }
      }
      if (ops) await batch.commit()

      // 회사명이 바뀌었으니 메타도 함께 고쳐 저장한다.
      const nextMeta = { ...(it.data.meta || {}), company: it.resolvedName }
      await setDoc(doc(db, COL, g.newKey, 'reports', it.reportId), {
        ...it.data,
        meta: nextMeta,
        companyKey: g.newKey,
        storedAt: Date.now(),
        regroupedFrom: it.oldKey,
      })

      // 회사 누적 문서를 이 보고서로 다시 쌓는다.
      await runTransaction(db, async (txn) => {
        const cur = await txn.get(doc(db, COL, g.newKey))
        const next = accumulateCompany(cur.exists() ? cur.data() : null, {
          ...it.data,
          meta: nextMeta,
          createdAt: it.data.createdAt || Date.now(),
        })
        txn.set(doc(db, COL, g.newKey), { ...next, storage: 'firestore' })
      })

      moved++
      removed.add(it.oldKey)
    }
  }

  // 4) 옮기고 난 빈 회사 문서를 지운다. 새 키와 같은 문서는 건드리지 않는다.
  for (const oldKey of removed) {
    if (groups.some((g) => g.newKey === oldKey)) continue
    log(`빈 회사 문서 정리: ${oldKey}`)
    const reps = await getDocs(collection(db, COL, oldKey, 'reports'))
    for (const r of reps.docs) {
      const chunks = await getDocs(collection(db, COL, oldKey, 'reports', r.id, 'content'))
      let batch = writeBatch(db)
      let ops = 0
      for (const c of chunks.docs) {
        batch.delete(c.ref)
        if (++ops >= 400) {
          await batch.commit()
          batch = writeBatch(db)
          ops = 0
        }
      }
      if (ops) await batch.commit()
    }
    const b = writeBatch(db)
    for (const r of reps.docs) b.delete(r.ref)
    b.delete(doc(db, COL, oldKey))
    await b.commit()
  }

  return { moved, removed: [...removed], groups: groups.map((g) => ({ key: g.newKey, name: g.name, count: g.items.length })), skipped }
}
