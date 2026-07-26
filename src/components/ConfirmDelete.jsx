import { useEffect, useRef, useState } from 'react'

/**
 * 삭제 확인 모달.
 *
 * window.prompt 를 쓰다가 갈아엎었다 — 임베드 브라우저·iframe 에서는 prompt 가
 * 차단돼 아무 반응 없이 취소된 것처럼 보인다. 되돌릴 수 없는 작업이라
 * 회사명을 그대로 입력해야 버튼이 열린다.
 */
export default function ConfirmDelete({ company, busy, onCancel, onConfirm }) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  if (!company) return null
  const ok = typed.trim() === company.name.trim()

  return (
    <div
      className="modal-back"
      role="dialog"
      aria-modal="true"
      aria-labelledby="del-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel()
      }}
    >
      <div className="modal">
        <h3 id="del-title">회사 삭제</h3>
        <p>
          <strong>{company.name}</strong> 의 보고서 {company.reportCount}건과 저장된 원문을 모두 지웁니다.
          되돌릴 수 없고, 다른 사람이 올린 자료여도 함께 사라집니다.
        </p>

        <label className="modal-label" htmlFor="del-input">
          확인을 위해 <code>{company.name}</code> 을(를) 그대로 입력하세요
        </label>
        <input
          id="del-input"
          ref={inputRef}
          className="modal-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && ok && !busy) onConfirm()
          }}
          placeholder={company.name}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />

        <div className="modal-actions">
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className="btn btn-danger" type="button" onClick={onConfirm} disabled={!ok || busy}>
            {busy ? <><span className="spinner" /> 삭제 중…</> : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
}
