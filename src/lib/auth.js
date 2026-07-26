// Google 로그인. 이 앱은 감사보고서 원문을 통째로 담고 있어 공개해 둘 수 없다.
// 읽기·쓰기 모두 로그인이 필요하고, 삭제는 관리자만 할 수 있다.
//
// 관리자 목록은 firestore.rules 에도 똑같이 박혀 있다 — 이쪽은 버튼을 숨기는 용도일 뿐이고,
// 실제 차단은 규칙이 한다. 둘 중 하나만 고치면 화면과 권한이 어긋나므로 같이 고쳐야 한다.

import { useEffect, useState } from 'react'
import { auth, googleProvider } from '../firebase.js'
import {
  signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged,
} from 'firebase/auth'

export const ADMIN_EMAILS = ['totoriverce@tukorea.ac.kr']

export const authAvailable = Boolean(auth)

export function isAdmin(user) {
  if (!user?.email) return false
  // 구글 계정이라도 이메일 미인증이면 신뢰하지 않는다(규칙도 같은 조건을 건다).
  if (!user.emailVerified) return false
  return ADMIN_EMAILS.includes(user.email.toLowerCase())
}

export async function signIn() {
  if (!auth) throw new Error('Firebase 설정이 없어 로그인할 수 없습니다.')
  try {
    await signInWithPopup(auth, googleProvider)
  } catch (e) {
    // 팝업 차단·중복 요청은 리다이렉트로 넘긴다. 취소는 조용히 무시한다.
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/cancelled-popup-request') {
      await signInWithRedirect(auth, googleProvider)
      return
    }
    if (e?.code === 'auth/popup-closed-by-user') return
    throw new Error(authMessage(e))
  }
}

export function signOut() {
  return auth ? fbSignOut(auth) : Promise.resolve()
}

/** @returns {{user:object|null, ready:boolean, admin:boolean}} */
export function useAuth() {
  const [state, setState] = useState({ user: null, ready: !authAvailable, admin: false })

  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (user) => {
      setState({ user, ready: true, admin: isAdmin(user) })
    })
  }, [])

  return state
}

function authMessage(e) {
  const code = e?.code || ''
  if (code === 'auth/unauthorized-domain') {
    return `이 도메인(${location.hostname})이 Firebase 승인된 도메인에 없습니다. Firebase 콘솔 → Authentication → Settings → 승인된 도메인에 추가해 주세요.`
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Firebase 콘솔에서 Google 로그인 제공업체가 켜져 있지 않습니다.'
  }
  if (code === 'auth/network-request-failed') return '네트워크 오류로 로그인하지 못했습니다.'
  return `로그인 실패 (${code || e?.message || '원인 불명'})`
}
