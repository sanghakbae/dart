// Firebase 초기화. 웹 config 는 클라이언트 번들에 그대로 실리는 공개 값이라
// 기본값으로 내장하고, 필요할 때 VITE_FIREBASE_* 로 덮어쓴다.
// 로그인(OAuth)은 쓰지 않는다 — 저장 경로 분리는 src/lib/workspace.js 참고.
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getAnalytics, isSupported } from 'firebase/analytics'

const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyAvvSo50YXo5pOP1VPzUZ7r9_Al_kUCvLc',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'dart-40a5c.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'dart-40a5c',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'dart-40a5c.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '20998563282',
  appId: env.VITE_FIREBASE_APP_ID || '1:20998563282:web:58c5e6fac1c9f3374cd40b',
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || 'G-45B7NVF30S',
}

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null
export const db = app ? getFirestore(app) : null

// Google 로그인. 업로드·열람은 로그인 없이 그대로 쓰고, 삭제처럼 되돌릴 수 없는 작업에만 쓴다.
export const auth = app ? getAuth(app) : null
export const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

// Analytics 는 지원되는 브라우저 환경에서만 (로컬 개발·비지원 환경 안전 가드)
export let analytics = null
if (app && firebaseConfig.measurementId) {
  isSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(app)
    })
    .catch(() => {})
}
