import { useState } from 'react'
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
  const [open, setOpen] = useState(false)

  // 5분마다 다시 보는데, 그때마다 칩을 걷어내면 상태가 깜빡인다.
  // 한 번이라도 받아 뒀으면 새 결과가 올 때까지 그대로 둔다.
  if (loading && !health) return <Badge tone="muted" dot><span title="외부 API 상태 확인 중">API 확인 중</span></Badge>
  if (error && !health) {
    return (
      <Badge tone="warn" dot>
        <span title={error} onClick={reload} style={{ cursor: 'pointer' }}>API 상태 불명</span>
      </Badge>
    )
  }

  // 평소에는 점 하나로 줄인다. 상태는 문제가 있을 때만 알면 되는 정보인데,
  // 서비스마다 칩을 띄우면 헤더의 절반을 진단 정보가 차지한다.
  const services = health?.services || []
  // 이 환경에서 아예 부를 수 없는 것(배포본의 국민연금)은 고장도 정상도 아니다.
  // 초록으로 칠하면 되는 줄 알고, 빨갛게 칠하면 멀쩡한 배포본이 장애로 보인다.
  const off = services.filter((s) => s.unavailable)
  const live = services.filter((s) => !s.unavailable)
  const down = live.filter((s) => !s.ok && !s.optional)
  const slow = live.filter((s) => s.ok && s.slow)
  const tone = down.length ? 'critical' : slow.length ? 'warn' : 'good'

  return (
    <div className="api-health">
      <button
        type="button"
        className={`api-pill api-${tone}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={
          down.length
            ? `${down.map((s) => s.label).join(', ')} 이상`
            : off.length
              ? `${off.map((s) => s.label).join(', ')} 은 이 서버에서 쓸 수 없습니다`
              : '외부 API 정상'
        }
      >
        <i className="dot" aria-hidden="true" />
        <span className="hide-sm">
          {down.length
            ? `API ${down.length}건 이상`
            : `API ${live.length}개 정상${off.length ? ` · ${off.length}개 미사용` : ''}`}
        </span>
      </button>

      {open && (
        <div className="api-pop" role="dialog" aria-label="외부 API 상태">
          <div className="api-pop-head">
            <strong>외부 API 상태</strong>
            <button type="button" className="btn btn-sm btn-ghost" onClick={reload}>다시 확인</button>
          </div>
          {/* 목록 전체가 하나의 그리드다(CSS 참고) — 배지 폭을 줄마다 맞추려는 것.
              li 가 display:contents 라 칸이 하나라도 빠지면 다음 줄이 밀린다.
              소요시간이 없어도 빈 칸을 남겨 둔다.
              role 은 display:contents 로 사라지는 목록 의미를 되살린다. */}
          <ul role="list">
            {services.map((s) => (
              <li key={s.id} role="listitem">
                <Badge
                  tone={
                    s.unavailable ? 'muted' : s.ok ? 'good' : s.slow ? 'warn' : s.optional ? 'muted' : 'critical'
                  }
                  dot
                >
                  {s.label}
                </Badge>
                <span className="api-detail">{s.detail}</span>
                <span className="api-ms">{s.ms != null ? `${s.ms}ms` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export default function Header({ storage, theme, onTheme, user, admin, onSignOut, onAdmin, adminView }) {
  return (
    <header className="app-header">
      <div className="wrap bar">
        <div className="brand">
          {/* 파비콘(public/favicon.svg)과 같은 그림. 둘이 어긋나면 탭과 헤더가 따로 논다. */}
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="20" height="20">
              <g fill="none" stroke="currentColor" strokeLinecap="round">
                <circle cx="28" cy="27" r="14" strokeWidth="5" />
                <path d="M38.5 37.5 L48 47" strokeWidth="7" />
              </g>
              <g fill="currentColor">
                <rect x="21" y="28" width="4" height="7" rx="1.4" />
                <rect x="26" y="23" width="4" height="12" rx="1.4" />
                <rect x="31" y="18" width="4" height="17" rx="1.4" />
              </g>
            </svg>
          </div>
          <div className="brand-text">
            <strong>파인더</strong>
            <span>감사보고서 · 공시 · 고용 · 투자 · 특허</span>
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
