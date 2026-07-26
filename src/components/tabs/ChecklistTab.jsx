import { useMemo, useState } from 'react'
import { Card, Badge, Callout, Empty, Seg } from '../ui'
import { buildChecklist } from '../../lib/analyze/checklist'

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

  return (
    <div className="stack-lg">
      <Card
        title="점검 결과"
        sub={`${result.checked}개 항목`}
        right={
          <Seg
            ariaLabel="점검 결과 필터"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `전체 ${result.checked}` },
              { value: 'bad', label: `위험 ${result.counts.bad || 0}` },
              { value: 'warn', label: `확인 ${result.counts.warn || 0}` },
            ]}
          />
        }
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="critical" dot>위험 신호 {result.counts.bad || 0}</Badge>
          <Badge tone="warn" dot>확인 필요 {result.counts.warn || 0}</Badge>
          <Badge tone="good" dot>양호 {result.counts.good || 0}</Badge>
          <Badge tone="info">참고 {result.counts.info || 0}</Badge>
          <Badge tone="muted">판정 불가 {result.counts.unknown || 0}</Badge>
        </div>
        <Callout tone="warn">
          <span>
            판정 기준은 업종을 가리지 않는 일반값이라 <strong>신호일 뿐 결론이 아닙니다.</strong>
            건설·금융·바이오처럼 재무구조가 특수한 업종은 기준 자체가 다릅니다. 각 항목의 근거 수치와
            주석 원문을 함께 확인하세요.
            {loading && ' (주석 본문을 아직 불러오는 중이라 일부 항목은 판정이 바뀔 수 있습니다.)'}
          </span>
        </Callout>
      </Card>

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
