import { useMemo, useState } from 'react'
import { Card, FinTable, Empty, Callout, Seg, Badge } from '../ui'
import { AmountTrend, GrowthBars, StructureStack, CashflowChart, RatioSpark, SERIES } from '../charts'
import { seriesFor, ratioSeriesFor } from '../../lib/analyze/series'
import { RATIO_GROUPS } from '../../lib/analyze/ratios'
import { ACCOUNT_BY_KEY } from '../../lib/parse/taxonomy'

const GROWTH_METRICS = [
  { key: 'revenue', label: '매출액' },
  { key: 'operatingProfit', label: '영업이익' },
  { key: 'netIncome', label: '당기순이익' },
  { key: 'totalAssets', label: '자산총계' },
]

export default function TrendTab({ timeline, reports, periodGroups = [], periodType, onPeriodType }) {
  const [metric, setMetric] = useState('revenue')
  const [group, setGroup] = useState('profitability')

  // 연결과 별도는 합산 범위가 달라 한 축에 섞으면 비교가 성립하지 않는다.
  const mixedBasis = useMemo(() => {
    const bases = [...new Set((reports || []).map((r) => r.meta?.basis).filter(Boolean))]
    if (bases.length < 2) return null
    return (reports || [])
      .map((r) => `${r.meta?.fiscalYear || '연도 미확인'}년 ${r.meta?.basis}`)
      .join(' · ')
  }, [reports])

  const amountKeys = [
    'revenue', 'operatingProfit', 'netIncome',
    'totalAssets', 'totalLiabilities', 'totalEquity',
    'cfOperating', 'cfInvesting', 'cfFinancing',
  ]
  const data = useMemo(() => seriesFor(timeline, amountKeys), [timeline])

  const growthByYear = useMemo(() => {
    return data
      .map((row, i) => ({
        label: row.label,
        value: row[`${metric}__growth`],
        current: row[metric],
        prior: i > 0 ? data[i - 1][metric] : null,
      }))
      .filter((r) => r.value != null)
  }, [data, metric])

  const activeGroup = RATIO_GROUPS.find((g) => g.key === group) || RATIO_GROUPS[0]
  const ratioData = useMemo(() => ratioSeriesFor(timeline, activeGroup.ratios.map((r) => r.key)), [timeline, activeGroup])

  const allKeys = useMemo(() => {
    const keys = new Set()
    for (const row of timeline.rows) {
      for (const k of Object.keys(row)) {
        if (k.startsWith('__') || k === 'year' || k === 'label') continue
        keys.add(k)
      }
    }
    return [...keys].sort((a, b) => (ACCOUNT_BY_KEY[a]?.level ?? 9) - (ACCOUNT_BY_KEY[b]?.level ?? 9))
  }, [timeline])

  if (!timeline.years.length) {
    return (
      <Card>
        <Empty title="추이를 만들 데이터가 없습니다">재무제표 숫자를 인식하지 못했습니다. 원문 탭에서 추출된 텍스트를 확인해 보세요.</Empty>
      </Card>
    )
  }

  return (
    <div className="stack-lg">
      <Card
        title="추이 데이터 구성"
        sub={`${timeline.years.length}개 연도 · 보고서 ${reports.length}건`}
        right={
          periodGroups.length > 1 ? (
            <Seg
              ariaLabel="보고기간 종류"
              value={periodType}
              onChange={onPeriodType}
              options={periodGroups.map((g) => ({ value: g.type, label: `${g.label} (${g.reports.length})` }))}
            />
          ) : null
        }
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {timeline.years.map((y) => (
            <Badge key={y} tone="info">{y}년</Badge>
          ))}
        </div>
        {periodGroups.length > 1 && (
          <Callout tone="warn">
            이 회사에는 보고기간 종류가 다른 보고서가 섞여 있습니다
            ({periodGroups.map((g) => `${g.label} ${g.reports.length}건`).join(' · ')}).
            누적 기간이 달라 한 축에 섞으면 비교가 성립하지 않으므로 <strong>{periodGroups.find((g) => g.type === periodType)?.label}</strong> 보고서만으로 추이를 만들었습니다.
          </Callout>
        )}
        {mixedBasis && (
          <Callout tone="warn">
            연결과 별도 기준이 섞여 있습니다 ({mixedBasis}). 연결은 종속회사까지 합산한 수치라
            별도와 같은 축에서 비교하면 증감이 실제보다 크게 보일 수 있습니다.
          </Callout>
        )}
        <Callout>
          같은 연도가 여러 보고서에 나오면 그 연도를 <strong>당기</strong>로 보고한 값을 우선 사용합니다(전기 비교치보다 정확).
          연도를 더 늘리려면 다른 사업연도의 보고서를 추가로 업로드하세요.
        </Callout>
      </Card>

      <AmountTrend
        title="손익 추이"
        sub="매출액 · 영업이익 · 당기순이익"
        data={data}
        series={[
          { key: 'revenue', label: '매출액', color: SERIES[0] },
          { key: 'operatingProfit', label: '영업이익', color: SERIES[1] },
          { key: 'netIncome', label: '당기순이익', color: SERIES[2] },
        ]}
        height={300}
      />

      <div className="grid grid-wide">
        <AmountTrend
          title="자산 · 부채 · 자본 추이"
          data={data}
          series={[
            { key: 'totalAssets', label: '자산총계', color: SERIES[0] },
            { key: 'totalLiabilities', label: '부채총계', color: SERIES[1] },
            { key: 'totalEquity', label: '자본총계', color: SERIES[2] },
          ]}
        />
        <StructureStack title="재무구조 비중 추이" sub="부채 + 자본 = 자산" data={data} />
      </div>

      <div className="grid grid-wide">
        <GrowthBars
          title="연도별 전년 대비 증감률"
          sub={GROWTH_METRICS.find((m) => m.key === metric)?.label}
          rows={growthByYear}
          note="각 연도 값을 직전 연도와 비교했습니다."
        />
        <CashflowChart title="현금흐름 추이" sub="영업 · 투자 · 재무활동" data={data} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ fontSize: 14 }}>증감률 기준 계정</strong>
        <Seg ariaLabel="증감률 기준 계정" value={metric} onChange={setMetric} options={GROWTH_METRICS.map((m) => ({ value: m.key, label: m.label }))} />
      </div>

      <section>
        <div className="card-head" style={{ border: 'none', padding: '0 0 10px', gap: 12 }}>
          <h3>재무비율 추이</h3>
          <span className="sub">{activeGroup.hint}</span>
          <div className="spacer">
            <Seg
              ariaLabel="비율 그룹"
              value={group}
              onChange={setGroup}
              options={RATIO_GROUPS.map((g) => ({ value: g.key, label: g.label }))}
            />
          </div>
        </div>
        <div className="grid">
          {activeGroup.ratios.map((r) => (
            <RatioSpark key={r.key} ratio={r} data={ratioData} />
          ))}
        </div>
        {!activeGroup.ratios.some((r) => ratioData.some((d) => d[r.key] != null)) && (
          <Card><Empty title="이 그룹의 비율을 계산할 수 없습니다">필요한 계정과목을 인식하지 못했습니다.</Empty></Card>
        )}
      </section>

      <Card title="연도별 전체 데이터" sub="인식된 모든 계정과목 × 연도 (원 단위)" tight>
        <FinTable
          minWidth={Math.max(560, 160 + timeline.years.length * 120)}
          columns={timeline.years.map((y) => ({ key: String(y), label: `${y}년` }))}
          rows={allKeys.map((k) => ({
            label: ACCOUNT_BY_KEY[k]?.label || k,
            level: ACCOUNT_BY_KEY[k]?.level ?? 1,
            isSum: (ACCOUNT_BY_KEY[k]?.level ?? 1) === 0,
            values: Object.fromEntries(timeline.rows.map((row) => [String(row.year), row[k] ?? null])),
          }))}
          note="빈 칸은 해당 연도 보고서에서 인식하지 못한 계정입니다."
        />
      </Card>

      <Card title="비율 전체 데이터" sub="연도별 재무비율" tight>
        <FinTable
          minWidth={Math.max(560, 200 + timeline.years.length * 110)}
          columns={timeline.years.map((y) => ({ key: String(y), label: `${y}년`, render: (v) => (v == null ? '-' : v.toLocaleString('ko-KR', { maximumFractionDigits: 2 })) }))}
          rows={RATIO_GROUPS.flatMap((g) =>
            g.ratios.map((r) => ({
              label: `${r.label} (${r.unit})`,
              level: 1,
              values: Object.fromEntries(timeline.rows.map((row) => [String(row.year), row.__ratios?.[r.key] ?? null])),
            }))
          )}
        />
      </Card>
    </div>
  )
}
