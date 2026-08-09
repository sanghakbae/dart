// 외부 API 인증키 등록(관리자 전용).
//
//   config/apiKeys        실제 값. 보안 규칙에서 클라이언트 읽기를 완전히 막았다.
//                         읽는 것은 서비스 계정을 가진 프록시 서버뿐이다.
//   config/apiKeyStatus   화면에 보여줄 것만 — 마지막 네 자리 · 길이 · 갱신 시각 · 누가.
//
// 값을 되읽지 않는 이유: 등록은 덮어쓰기면 충분하고, 읽을 수 있게 해 두면 관리자
// 계정 하나가 뚫렸을 때 인증키 네 개가 통째로 새 나간다.

import { db } from '../firebase.js'
import { doc, getDoc, setDoc } from 'firebase/firestore'

/** 등록 가능한 API. name 은 서버 환경변수 이름과 같아야 한다(폴백이 맞물린다). */
export const API_SPECS = [
  {
    name: 'DART_API_KEY',
    label: 'DART 전자공시',
    hint: 'opendart.fss.or.kr 인증키. 공시 목록·원문 조회에 쓴다.',
    issuer: 'https://opendart.fss.or.kr',
  },
  {
    name: 'NPS_API_KEY',
    label: '국민연금 가입 사업장',
    hint: 'data.go.kr Decoding 키. 고용 인원 추이에 쓴다.',
    issuer: 'https://www.data.go.kr',
  },
  {
    name: 'KIPRIS_API_KEY',
    label: 'KIPRIS 특허',
    hint: 'plus.kipris.or.kr accessKey. data.go.kr 키가 아니다.',
    issuer: 'https://plus.kipris.or.kr',
  },
]

const KEY_DOC = () => doc(db, 'config', 'apiKeys')
const STATUS_DOC = () => doc(db, 'config', 'apiKeyStatus')

/** 값 자체는 남기지 않는다. 어느 키인지 알아볼 만큼만 남긴다. */
function maskOf(value) {
  const v = String(value || '').trim()
  return { length: v.length, tail: v.length > 4 ? v.slice(-4) : '' }
}

/** 등록 현황(마스킹된 것) */
export async function loadApiKeyStatus() {
  if (!db) return {}
  try {
    const snap = await getDoc(STATUS_DOC())
    return snap.exists() ? snap.data() : {}
  } catch {
    // 관리자가 아니면 규칙에서 막힌다 — 화면에서는 '등록 정보 없음'으로 보이면 된다.
    return {}
  }
}

/**
 * 인증키 등록. 값 문서와 상태 문서를 함께 갱신한다.
 * @param {string} name  API_SPECS 의 name
 * @param {string} value 인증키 원문
 * @param {{email?: string}} [by]
 */
export async function saveApiKey(name, value, by) {
  if (!db) throw new Error('DB 가 설정되지 않았습니다.')
  const key = String(value || '').trim()
  if (!key) throw new Error('인증키가 비어 있습니다.')
  if (!API_SPECS.some((s) => s.name === name)) throw new Error(`알 수 없는 API: ${name}`)

  await setDoc(KEY_DOC(), { [name]: key }, { merge: true })
  await setDoc(
    STATUS_DOC(),
    { [name]: { ...maskOf(key), updatedAt: Date.now(), updatedBy: by?.email || null } },
    { merge: true }
  )
}

/**
 * 등록 해제. 값을 빈 문자열로 덮는다 — 서버는 빈 값을 '미등록'으로 보고
 * 환경 시크릿으로 되돌아간다.
 */
export async function clearApiKey(name, by) {
  if (!db) throw new Error('DB 가 설정되지 않았습니다.')
  await setDoc(KEY_DOC(), { [name]: '' }, { merge: true })
  await setDoc(
    STATUS_DOC(),
    { [name]: { length: 0, tail: '', updatedAt: Date.now(), updatedBy: by?.email || null } },
    { merge: true }
  )
}
