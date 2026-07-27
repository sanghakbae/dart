import { Badge, Empty, Callout } from './ui'
import { dateTimeText } from '../lib/format'

/**
 * 외부 API 탭의 공통 머리말 — 출처, 받아온 시각, 받아오기 버튼.
 * 자동 조회를 하지 않으므로 "언제 받은 값인지" 를 늘 붙여 둔다.
 */
export function RemoteBar({ source, fetchedAt, stale, fetching, phase, onFetch }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Badge tone="muted">{source}</Badge>
      <span className="chip" title={fetchedAt ? new Date(fetchedAt).toLocaleString('ko-KR') : undefined}>
        {fetchedAt ? `${dateTimeText(fetchedAt)} 기준` : '받아온 적 없음'}
        {fetchedAt && stale ? ' · 오래됨' : ''}
      </span>
      <button className="btn btn-sm" type="button" onClick={onFetch} disabled={fetching}>
        {fetching ? <><span className="spinner" /> {phase || '받는 중…'}</> : fetchedAt ? '다시 받아오기' : '받아오기'}
      </button>
    </div>
  )
}

/** 아직 한 번도 받아오지 않았을 때. 조회는 사용자가 눌러야 시작된다. */
export function RemoteEmpty({ source, title, children, fetching, phase, onFetch, error }) {
  return (
    <div className="stack">
      {error && <Callout tone="warn">{error}</Callout>}
      <Empty
        title={title}
        action={
          <button className="btn btn-primary" type="button" onClick={onFetch} disabled={fetching}>
            {fetching ? <><span className="spinner" /> {phase || '받는 중…'}</> : `${source} 에서 받아오기`}
          </button>
        }
      >
        {children}
      </Empty>
    </div>
  )
}
