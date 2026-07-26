import { Badge } from './ui'

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

        <Badge
          tone={storage.mode === 'firestore' ? 'good' : storage.mode === 'blocked' ? 'warn' : 'muted'}
          dot
        >
          <span title={storage.hint}>{storage.label}</span>
        </Badge>

        {admin && (
          <button
            className={`btn btn-sm${adminView ? ' btn-primary' : ''}`}
            type="button"
            onClick={onAdmin}
            title="이용 현황"
          >
            이용 현황
          </button>
        )}

        {user && (
          <span
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
          <button className="btn btn-sm btn-ghost" type="button" onClick={onSignOut}>
            로그아웃
          </button>
        )}

        <button className="btn btn-sm btn-ghost" type="button" onClick={onTheme} aria-label="밝기 전환" title="밝기 전환">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}
