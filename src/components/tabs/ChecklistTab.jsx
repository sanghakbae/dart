import { useMemo, useState } from 'react'
import { Card, Badge, Callout, Empty, Seg } from '../ui'
import { buildChecklist } from '../../lib/analyze/checklist'
import RelatedPartyCard from '../RelatedPartyCard'

const TONE = {
  good: { badge: 'good', mark: '✓', label: '양호' },
  warn: { badge: 'warn', mark: '!', label: '확인 필요' },
  bad: { badge: 'critical', mark: '✕', label: '위험 신호' },
  info: { badge: 'info', mark: 'i', label: '참고' },
  unknown: { badge: 'muted', mark: '?', label: '판정 불가' },
}

export default function ChecklistTab({ report, timeline, notes, loading }) {
  const [filter, setFilter] = useState('all')
  const result = useMemo(() => buildChecklist(report, timeline, notes), [report, timeline, notes])

  if (!result.checked) {
    return <Card><Empty title="점검할 데이터가 없습니다" /></Card>
  }

  const shown = (items) => (filter === 'all' ? items : items.filter((i) => i.status === filter))
  const visibleCount = filter === 'all' ? result.checked : result.counts[filter] || 0

  // 상태 배지가 곧 필터다. 같은 것을 다시 누르면 전체로 돌아간다.
  const chip = (status, tone, label, dot) => {
    const n = result.counts[status] || 0
    const active = filter === status
    return (
      <button
        type="button"
        className={`badge badge-${tone} chip-filter${active ? ' active' : ''}`}
        onClick={() => setFilter(active ? 'all' : status)}
        disabled={n === 0 && !active}
        aria-pressed={active}
        title={n === 0 ? `${label} 항목이 없습니다` : `${label}만 보기`}
      >
        {dot && <i className="dot" />}
        {label} {n}
      </button>
    )
  }

  return (
    <div className="stack-lg">
      {/* 재무제표 본문에 안 나오고 주석에만 있는 두 가지. 투자 실사에서 반드시 본다. */}
      <RelatedPartyCard report={report} notes={notes} />

      <Card
        title="점검 결과"
        sub={filter === 'all' ? `${result.checked}개 항목` : `${visibleCount}개 항목 · 필터 적용 중`}
        right={
          <Seg
            ariaLabel="점검 결과 필터"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: `전체 ${result.checked}` }]}
          />
        }
      >
        <div className="stack">
          <div className="chip-filters">
            {chip('bad', 'critical', '위험 신호', true)}
            {chip('warn', 'warn', '확인 필요', true)}
            {chip('good', 'good', '양호', true)}
            {chip('info', 'info', '참고', false)}
            {chip('unknown', 'muted', '판정 불가', false)}
          </div>
          <Callout tone="warn">
            <span>
              판정 기준은 업종을 가리지 않는 일반값이라 <strong>신호일 뿐 결론이 아닙니다.</strong>{' '}
              건설·금융·바이오처럼 재무구조가 특수한 업종은 기준 자체가 다릅니다. 각 항목의 근거 수치와
              주석 원문을 함께 확인하세요.
              {loading && ' (주석 본문을 아직 불러오는 중이라 일부 항목은 판정이 바뀔 수 있습니다.)'}
            </span>
          </Callout>
        </div>
      </Card>

      {visibleCount === 0 && (
        <Card>
          <Empty title={`${TONE[filter]?.label || ''} 항목이 없습니다`}>
            위 배지를 다시 눌러 전체 목록으로 돌아갈 수 있습니다.
          </Empty>
        </Card>
      )}

      {result.groups.map((g) => {
        const items = shown(g.items)
        if (!items.length) return null
        return (
          <Card key={g.name} title={g.name} sub={`${items.length}개 항목`} tight>
            <ul className="checklist">
              {items.map((it) => {
                const tone = TONE[it.status] || TONE.info
                return (
                  <li key={it.id} className={`check check-${it.status}`}>
                    <span className={`check-mark ${it.status}`} aria-hidden="true">{tone.mark}</span>
                    <div className="check-body">
                      <div className="check-head">
                        <strong>{it.title}</strong>
                        <Badge tone={tone.badge}>{tone.label}</Badge>
                      </div>
                      <div className="check-value">{it.value}</div>
                      {it.detail && <div className="check-detail">{it.detail}</div>}
                      <div className="check-why">{it.why}</div>
                      {it.source && (
                        <div className="check-src">근거: 주석 {it.source.no}. {it.source.title}</div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}
    </div>
  )
}
