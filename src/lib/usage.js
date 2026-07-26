// 이용 현황. Firebase Auth 의 사용자 목록은 Admin SDK 로만 읽을 수 있고 이 앱에는 서버가 없다.
// 그래서 로그인할 때마다 users/{uid} 문서를 직접 남기고, 관리자 페이지는 그 컬렉션을 읽는다.
//
//   users/{uid}  { uid, email, name, photo, firstSeenAt, lastSeenAt, loginCount, uploadCount }
//
// 규칙상 본인 문서만 쓸 수 있고, 전체 조회는 관리자만 가능하다.

import { db, auth } from '../firebase.js'
import {
  doc, setDoc, getDoc, getDocs, collection, query, orderBy, limit, increment, serverTimestamp,
} from 'firebase/firestore'

const COL = 'users'

/** 로그인 직후 호출. 최초면 만들고, 이후엔 접속 시각과 횟수만 올린다. */
export async function touchUser(user) {
  if (!db || !user) return
  const ref = doc(db, COL, user.uid)
  const base = {
    uid: user.uid,
    email: user.email || null,
    name: user.displayName || null,
    photo: user.photoURL || null,
    lastSeenAt: Date.now(),
    lastSeenServer: serverTimestamp(),
  }
  try {
    const snap = await getDoc(ref)
    if (snap.exists()) {
      await setDoc(ref, { ...base, loginCount: increment(1) }, { merge: true })
    } else {
      await setDoc(ref, { ...base, firstSeenAt: Date.now(), loginCount: 1, uploadCount: 0 })
    }
  } catch {
    // 접속 기록 실패가 로그인 자체를 막아서는 안 된다.
  }
}

/** 업로드 1건 반영. 실패해도 업로드 흐름을 끊지 않는다. */
export async function bumpUpload() {
  const user = auth?.currentUser
  if (!db || !user) return
  try {
    await setDoc(doc(db, COL, user.uid), { uploadCount: increment(1), lastUploadAt: Date.now() }, { merge: true })
  } catch {
    /* 무시 */
  }
}

/** 관리자 전용 — 전체 사용자 목록. 규칙이 막으면 permission-denied 가 그대로 올라온다. */
export async function listUsers(max = 200) {
  if (!db) return []
  const snap = await getDocs(query(collection(db, COL), orderBy('lastSeenAt', 'desc'), limit(max)))
  return snap.docs.map((d) => ({ ...d.data(), uid: d.id }))
}
