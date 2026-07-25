// Firebase 초기화. 웹 config 는 클라이언트 번들에 그대로 실리는 공개 값이라
// 기본값으로 내장하고, 필요할 때 VITE_FIREBASE_* 로 덮어쓴다.
import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
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
export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
export const googleProvider = new GoogleAuthProvider()

// Analytics 는 지원되는 브라우저 환경에서만 (로컬 개발·비지원 환경 안전 가드)
export let analytics = null
if (app && firebaseConfig.measurementId) {
  isSupported()
    .then((ok) => {
      if (ok) analytics = getAnalytics(app)
    })
    .catch(() => {})
}

// 로그인 허용 이메일 제한 (쉼표 구분). 비우면 모든 Google 계정 허용.
export const ALLOWED_EMAILS = (env.VITE_ALLOWED_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)
