import { Card, FinTable, Tile, Callout } from '../ui'
import { RatioSpark } from '../charts'
import { RATIO_GROUPS } from '../../lib/analyze/ratios'
import { ratioSeriesFor } from '../../lib/analyze/series'
import { ratioText } from '../../lib/format'

export default function RatioTab({ report, timeline }) {
  const ratios = report.ratios || { current: {}, prior: {} }
  const periods = report.periods || []
  const curLabel = periods[0]?.label || '당기'
  const priLabel = periods[1]?.label || '전기'
  const allKeys = RATIO_GROUPS.flatMap((g) => g.ratios.map((r) => r.key))
  const series = ratioSeriesFor(timeline, allKeys)

  return (
    <div className="stack-lg">
      <Callout>
        비율은 인식된 계정과목으로 계산합니다. 계산에 필요한 계정이 없으면 <strong>-</strong> 로 표시됩니다.
        업종에 따라 적정 수준이 크게 달라 기준선은 참고용입니다.
      </Callout>

      {RATIO_GROUPS.map((g) => {
        const rows = g.ratios.map((r) => {
          const cur = ratios.current?.[r.key] ?? null
          const pri = ratios.prior?.[r.key] ?? null
          return {
            label: r.label,
            level: 1,
            values: {
              current: cur,
              prior: pri,
              diff: cur != null && pri != null ? cur - pri : null,
              unit: r.unit,
              bench: r.bench != null ? `${r.bench}${r.unit}` : '-',
            },
          }
        })
        const has = rows.some((r) => r.values.current != null || r.values.prior != null)

        return (
          <section key={g.key} className="stack">
            <div className="card-head" style={{ border: 'none', padding: '0 0 4px' }}>
              <h3>{g.label}</h3>
              <span className="sub">{g.hint}</span>
            </div>

            {has && (
              <div className="grid grid-tiles">
                {g.ratios
                  .filter((r) => ratios.current?.[r.key] != null)
                  .map((r) => {
                    const cur = ratios.current[r.key]
                    const pri = ratios.prior?.[r.key] ?? null
                    const diff = pri != null ? cur - pri : null
                    const improved = diff == null ? null : r.good === 'low' ? diff < 0 : diff > 0
                    return (
                      <Tile
                        key={r.key}
                        label={r.label}
                        value={ratioText(cur, r.unit)}
                        unit={pri != null ? `${priLabel} ${ratioText(pri, r.unit)}` : undefined}
                        delta={diff != null ? (improved ? Math.abs(diff) : -Math.abs(diff)) : null}
                        deltaLabel={diff != null ? `p ${improved ? '개선' : '악화'}` : undefined}
                        hint={`${r.label} · ${curLabel} ${ratioText(cur, r.unit)}`}
                      />
                    )
                  })}
              </div>
            )}

            <Card tight>
              <FinTable
                columns={[
                  { key: 'current', label: curLabel, render: (v, r) => ratioText(v, r.values.unit) },
                  { key: 'prior', label: priLabel, render: (v, r) => ratioText(v, r.values.unit) },
                  { key: 'diff', label: '증감(%p)', render: (v) => (v == null ? '-' : `${v > 0 ? '+' : ''}${v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}`) },
                  { key: 'bench', label: '참고 기준' },
                ]}
                rows={rows}
              />
            </Card>

            <div className="grid">
              {g.ratios.map((r) => (
                <RatioSpark key={r.key} ratio={r} data={series} />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
