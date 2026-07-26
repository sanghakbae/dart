import { useState } from 'react'
import { signIn } from '../lib/auth'
import { Callout } from './ui'

/** 로그인 전 화면. 이 앱은 감사보고서 원문을 담고 있어 익명 열람을 막는다. */
export default function SignIn({ configured }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drop" style={{ maxWidth: 520, marginInline: 'auto', marginTop: 40 }}>
      <h2>로그인이 필요합니다</h2>
      <p>
        업로드된 감사보고서에는 재무제표와 주석 원문이 그대로 담겨 있습니다.
        구글 계정으로 로그인한 사용자만 열람·업로드할 수 있습니다.
      </p>

      <div style={{ marginTop: 18 }}>
        <button className="btn btn-primary" type="button" onClick={go} disabled={busy || !configured}>
          {busy ? <><span className="spinner" /> 로그인 중…</> : 'Google 계정으로 로그인'}
        </button>
      </div>

      {!configured && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="warn">
            Firebase 설정이 없어 로그인을 쓸 수 없습니다. <code>.env</code> 의 <code>VITE_FIREBASE_*</code> 값을 확인해 주세요.
          </Callout>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16 }}>
          <Callout tone="warn">{error}</Callout>
        </div>
      )}
    </div>
  )
}
