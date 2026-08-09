import { useCallback, useEffect, useState } from 'react'
import { Card, Callout, Badge, Empty } from './ui'
import { API_SPECS, loadApiKeyStatus, saveApiKey, clearApiKey } from '../lib/apiKeys'
import { dateTimeText } from '../lib/format'

/**
 * 외부 API 인증키 등록(관리자 전용).
 *
 * 등록한 값은 DB 에 들어가고 프록시 서버가 읽어 쓴다. 여기서 되읽지는 않는다 —
 * 값 문서는 보안 규칙에서 클라이언트 읽기를 막아 두었고, 화면에는 마지막 네 자리만 보인다.
 * 그래서 입력칸은 항상 비어 있고, 저장하면 덮어쓴다.
 */
export default function ApiKeyCard({ user }) {
  const [status, setStatus] = useState({})
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const [health, setHealth] = useState(null)

  const refresh = useCallback(() => {
    loadApiKeyStatus().then(setStatus).catch(() => setStatus({}))
  }, [])

  useEffect(refresh, [refresh])

  // 프록시가 실제로 어느 쪽 값을 쓰고 있는지(DB / 환경 시크릿) 같이 보여 준다.
  useEffect(() => {
    fetch('/health')
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => setHealth(null))
  }, [])

  const save = async (name) => {
    const value = (drafts[name] || '').trim()
    if (!value) return
    setBusy(name)
    setError(null)
    setDone(null)
    try {
      await saveApiKey(name, value, user)
      setDrafts((d) => ({ ...d, [name]: '' }))
      setDone(name)
      refresh()
    } catch (e) {
      setError(`${name}: ${e?.message || e}`)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (name) => {
    setBusy(name)
    setError(null)
    setDone(null)
    try {
      await clearApiKey(name, user)
      refresh()
    } catch (e) {
      setError(`${name}: ${e?.message || e}`)
    } finally {
      setBusy(null)
    }
  }

  const registered = API_SPECS.filter((s) => status[s.name]?.length > 0).length

  return (
    <Card title="외부 API 인증키" sub={`${API_SPECS.length}개 중 ${registered}개 등록됨`} tight>
      <div className="card-body" style={{ paddingBottom: 0 }}>
        <Callout>
          등록한 키는 <strong>DB 에 저장</strong>되고 프록시 서버가 읽어 씁니다. 보안상 저장한 값은
          다시 보이지 않고 <strong>마지막 네 자리</strong>만 표시됩니다 — 바꾸려면 새 값을 넣어 덮어쓰세요.
          등록을 지우면 서버에 설정된 기존 값으로 되돌아갑니다.
        </Callout>
        {health && health.fromDb === false && (
          <Callout tone="warn">
            프록시가 아직 <strong>DB 가 아니라 서버 환경값</strong>을 쓰고 있습니다. 여기서 등록해도
            반영되지 않습니다 — Firebase 서비스 계정을 <code>FIREBASE_SERVICE_ACCOUNT</code> 로
            넣어야 DB 를 읽습니다.
          </Callout>
        )}
        {error && <Callout tone="bad">{error}</Callout>}
      </div>

      {!API_SPECS.length ? (
        <div className="card-body"><Empty title="등록할 API 가 없습니다" /></div>
      ) : (
        <ul className="keylist">
          {API_SPECS.map((s) => {
            const st = status[s.name]
            const on = st?.length > 0
            return (
              <li key={s.name} className="keyrow">
                <div className="keyrow-head">
                  <strong>{s.label}</strong>
                  <Badge tone={on ? 'good' : 'muted'} dot>
                    {on ? `등록됨 ····${st.tail}` : '미등록'}
                  </Badge>
                  {done === s.name && <Badge tone="info">저장했습니다</Badge>}
                </div>
                <div className="keyrow-hint">
                  {s.hint}
                  {' '}
                  <a href={s.issuer} target="_blank" rel="noreferrer">발급처</a>
                  {on && st.updatedAt && (
                    <>
                      {' · '}
                      {dateTimeText(st.updatedAt)}
                      {st.updatedBy ? ` · ${st.updatedBy}` : ''}
                    </>
                  )}
                </div>
                <div className="keyrow-form">
                  <input
                    type="password"
                    value={drafts[s.name] || ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.name]: e.target.value }))}
                    placeholder={on ? '새 값을 넣으면 덮어씁니다' : '인증키를 붙여넣으세요'}
                    aria-label={`${s.label} 인증키`}
                    autoComplete="off"
                    spellCheck="false"
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => save(s.name)}
                    disabled={busy === s.name || !(drafts[s.name] || '').trim()}
                  >
                    {busy === s.name ? '저장 중…' : '저장'}
                  </button>
                  {on && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => remove(s.name)}
                      disabled={busy === s.name}
                    >
                      등록 해제
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
