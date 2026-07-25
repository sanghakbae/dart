import { Card, Tile, Badge, Insight, Callout, KV, FinTable, Empty } from '../ui'
import { AmountTrend, GrowthBars, StructureStack, ProfitWaterfall, CompositionDonut, SERIES } from '../charts'
import { headlineTiles, growthRows, waterfallSteps, assetSlices } from '../../lib/analyze/view'
import { seriesFor } from '../../lib/analyze/series'
import { full, dateText, fileSize, signedPct } from '../../lib/format'

export default function SummaryTab({ report, timeline }) {
  const { meta, values, opinion, insights, quality, periods } = report
  const tiles = headlineTiles(values)
  const gRows = growthRows(values)
  const steps = waterfallSteps(values)
  const trend = seriesFor(timeline, ['revenue', 'operatingProfit', 'netIncome', 'totalAssets', 'totalLiabilities', 'totalEquity'])
  const curLabel = periods?.[0]?.label || '당기'
  const priLabel = periods?.[1]?.label || '전기'

  return (
    <div className="stack-lg">
      <Card
        title="보고서 개요"
        right={
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Badge tone={opinion?.tone} dot>{opinion?.label || '의견 미확인'}</Badge>
            <Badge tone="info">{meta.basis}재무제표</Badge>
            {report.goingConcern?.flagged && <Badge tone="critical" dot>계속기업 불확실성</Badge>}
            {report.internalControl?.effective === false && <Badge tone="critical" dot>내부회계 미비</Badge>}
          </div>
        }
      >
        <div className="grid">
          <KV
            items={[
              { k: '회사명', v: meta.company },
              { k: '사업연도', v: meta.fiscalYear ? `${meta.fiscalYear}년${meta.termNo ? ` (제${meta.termNo}기)` : ''}` : '미확인' },
              { k: '비교기간', v: `${curLabel} · ${priLabel}` },
              { k: '문서 종류', v: meta.docKind },
            ]}
          />
          <KV
            items={[
              { k: '감사인', v: meta.auditor || '미확인' },
              { k: '감사보고서일', v: dateText(meta.reportDate) },
              { k: '업무수행이사', v: report.auditPartner || '미확인' },
              { k: '원본 파일', v: `${meta.fileName} (${fileSize(meta.fileSize)}${meta.pageCount ? `, ${meta.pageCount}p` : ''})` },
            ]}
          />
        </div>

        {quality?.warnings?.length > 0 && (
          <div className="stack" style={{ marginTop: 14 }}>
            {quality.warnings.map((w) => (
              <Callout tone="warn" key={w}>{w}</Callout>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <span className="chip">계정 인식률 {quality?.score ?? 0}%</span>
          <span className="chip">인식 계정 {report.stats?.accountCount ?? 0}개</span>
          <span className="chip">표 블록 {report.stats?.blockCount ?? 0}개</span>
          <span className="chip">주석 {report.notesCount ?? report.notes?.count ?? 0}개</span>
          {quality?.balanceOk === true && <span className="chip">자산 = 부채+자본 검증 통과</span>}
          {quality?.balanceOk === false && <Badge tone="warn">대차 불일치</Badge>}
        </div>
      </Card>

      <section>
        <div className="card-head" style={{ border: 'none', padding: '0 0 10px' }}>
          <h3>주요 지표 · {curLabel}</h3>
          <span className="sub">괄호 없는 값은 원 단위 축약 표기. 표에서 전체 자릿수를 볼 수 있습니다.</span>
        </div>
        {tiles.length ? (
          <div className="grid grid-tiles">
            {tiles.map((t) => (
              <Tile
                key={t.key}
                label={t.label}
                value={t.value}
                unit={t.value != null ? `${full(t.value)}원` : undefined}
                delta={t.delta}
                deltaLabel={`vs ${priLabel}`}
              />
            ))}
          </div>
        ) : (
          <Card><Empty title="주요 지표를 인식하지 못했습니다">재무제표 탭에서 인식된 원문 표를 직접 확인할 수 있습니다.</Empty></Card>
        )}
      </section>

      {insights?.length > 0 && (
        <Card title="자동 판독" sub="숫자에서 바로 확인되는 사실만 정리했습니다">
          {insights.map((i, idx) => (
            <Insight tone={i.tone} key={idx}>{i.text}</Insight>
          ))}
        </Card>
      )}

      <div className="grid grid-wide">
        <AmountTrend
          title="손익 추이"
          sub={`${timeline.years.length}개 연도`}
          data={trend}
          series={[
            { key: 'revenue', label: '매출액', color: SERIES[0] },
            { key: 'operatingProfit', label: '영업이익', color: SERIES[1] },
            { key: 'netIncome', label: '당기순이익', color: SERIES[2] },
          ]}
          note="감사보고서 1건에도 당기·전기가 담겨 있어 2개 연도가 표시됩니다. 다른 연도 보고서를 추가 업로드하면 축이 자동으로 늘어납니다."
        />
        <GrowthBars title={`전년 대비 증감률 · ${curLabel} vs ${priLabel}`} rows={gRows} note="전기 값이 음수인 항목은 절대값 기준으로 계산했습니다." />
      </div>

      <div className="grid grid-wide">
        <StructureStack title="재무구조 추이" sub="부채 + 자본 = 자산" data={trend} />
        {steps.length > 0 ? (
          <ProfitWaterfall title={`손익 구조 · ${curLabel}`} steps={steps} note="매출액에서 각 비용을 차감해 당기순이익까지 이어지는 흐름입니다." />
        ) : (
          <CompositionDonut title={`자산 구성 · ${curLabel}`} slices={assetSlices(values)} />
        )}
      </div>

      <Card title="당기 · 전기 요약표" sub="모든 숫자를 원 단위로 표시" tight>
        <FinTable
          columns={[
            { key: 'current', label: curLabel },
            { key: 'prior', label: priLabel },
            { key: 'diff', label: '증감' },
            { key: 'rate', label: '증감률', render: (v) => signedPct(v) },
          ]}
          rows={tiles.map((t) => ({
            label: t.label,
            level: 0,
            derived: t.derived,
            values: {
              current: t.value,
              prior: t.prior,
              diff: t.value != null && t.prior != null ? t.value - t.prior : null,
              rate: t.delta,
            },
          }))}
          note="‘계산값’ 표시는 원문에 없어 다른 계정에서 산출한 값입니다."
        />
      </Card>
    </div>
  )
}
