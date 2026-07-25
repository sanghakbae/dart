import { Badge } from './ui'

export default function Header({ storage, theme, onTheme }) {
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

        <button className="btn btn-sm btn-ghost" type="button" onClick={onTheme} aria-label="밝기 전환" title="밝기 전환">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}
