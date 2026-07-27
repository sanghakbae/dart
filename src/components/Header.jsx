import { Badge } from './ui'
import { useHealth } from '../lib/health'

/**
 * 외부 API 상태 칩.
 *
 * 키가 있어도 조용히 실패하는 일이 잦았다 — 국민연금은 파라미터 표기가 바뀐 뒤
 * 오류 없이 0건만 돌려줬고, KIPRIS 는 사용기간이 끝나도 200 으로 응답한다.
 * 그래서 프록시가 상류를 실제로 불러 본 결과를 여기에 그대로 띄운다.
 */
function ApiHealth() {
  const { health, error, loading, reload } = useHealth()

  if (loading) return <Badge tone="muted" dot><span title="외부 API 상태 확인 중">API 확인 중</span></Badge>
  if (error) {
    return (
      <Badge tone="warn" dot>
        <span title={error} onClick={reload} style={{ cursor: 'pointer' }}>API 상태 불명</span>
      </Badge>
    )
  }

  return (
    <span className="api-health" onClick={reload} title="눌러서 다시 확인">
      {(health?.services || []).map((s) => (
        <Badge key={s.id} tone={s.ok ? 'good' : s.optional ? 'muted' : 'critical'} dot>
          <span
            className="api-lbl"
            data-short={s.short || s.label}
            title={`${s.label}: ${s.detail}${s.ms != null ? ` (${s.ms}ms)` : ''}`}
          >
            {s.label}
          </span>
        </Badge>
      ))}
    </span>
  )
}

export default function Header({ storage, theme, onTheme, user, admin, onSignOut, onAdmin, adminView }) {
  return (
    <header className="app-header">
      <div className="wrap bar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">감</div>
          <div className="brand-text">
            <strong>감사보고서 분석기</strong>
            <span>업로드 · 전체 내용 분석 · 전년 대비 추이</span>
          </div>
        </div>

        {/* DB 상태는 평소 늘 정상이라 자리만 차지했다. 문제가 있을 때만 띄운다. */}
        {storage.mode !== 'firestore' && (
          <Badge tone={storage.mode === 'blocked' ? 'warn' : 'muted'} dot>
            <span className="api-lbl" data-short={storage.short || 'DB'} title={storage.hint}>
              {storage.label}
            </span>
          </Badge>
        )}

        <ApiHealth />

        {admin && (
          <button
            className={`btn btn-sm${adminView ? ' btn-primary' : ''}`}
            type="button"
            onClick={onAdmin}
            title="이용 현황"
          >
            <span className="api-lbl" data-short="현황">이용 현황</span>
          </button>
        )}

        {user && (
          <span
            className="user-chip"
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-2)' }}
            title={user.email || ''}
          >
            {user.photoURL && (
              <img
                src={user.photoURL}
                alt=""
                width={22}
                height={22}
                style={{ borderRadius: '50%', display: 'block' }}
                referrerPolicy="no-referrer"
              />
            )}
            <span className="hide-sm">{user.displayName || user.email}</span>
          </span>
        )}

        {user && (
          <button className="btn btn-sm btn-ghost" type="button" onClick={onSignOut} title="로그아웃">
            <span className="api-lbl" data-short="⏻">로그아웃</span>
          </button>
        )}

        <button className="btn btn-sm btn-ghost" type="button" onClick={onTheme} aria-label="밝기 전환" title="밝기 전환">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}
