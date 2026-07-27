import { useMemo, useState } from 'react'
import { Card, Tile, Callout, FinTable, Empty, Badge } from '../ui'
import { valuate, DEFAULT_MULTIPLES } from '../../lib/analyze/valuation'
import { abbrev, full } from '../../lib/format'
import { SERIES } from '../charts'

const KNOBS = [
  { key: 'per', label: 'PER (배)', min: 1, max: 40, step: 0.5 },
  { key: 'pbr', label: 'PBR (배)', min: 0.1, max: 10, step: 0.1 },
  { key: 'evEbitda', label: 'EV/EBIT (배)', min: 1, max: 30, step: 0.5 },
]

export default function ValuationTab({ report, timeline }) {
  const [multiples, setMultiples] = useState(DEFAULT_MULTIPLES)
  const values = report?.values || {}
  const shares = report?.shares || null

  const rcps = report?.rcps || null

  const v = useMemo(
    () => valuate(values, timeline?.rows || [], shares, multiples, rcps),
    [values, timeline, shares, multiples, rcps]
  )

  if (!v.available) {
    return (
      <Card>
        <Empty title="가치를 계산할 수 없습니다">
          자본총계·당기순이익 같은 기본 계정을 인식하지 못했습니다. 재무제표 탭에서 인식 결과를 확인해 주세요.
        </Empty>
      </Card>
    )
  }

  const curLabel = report?.periods?.[0]?.label || '당기'

  return (
    <div className="stack-lg">
      <Callout tone="warn">
        <span>
          <strong>추정치이며 투자 판단 근거가 아닙니다.</strong> 감사보고서에는 시가·거래사례·동종업계 배수가 없어
          시장가치를 알 수 없습니다. 아래는 재무제표에서 곧바로 계산되는 값일 뿐이고, 실제 거래가격은 성장성·
          경영권 프리미엄·비상장 할인 등으로 크게 달라집니다.
        </span>
      </Callout>

      <section>
        <div className="card-head" style={{ border: 'none', padding: '0 0 10px' }}>
          <h3>추정 기업가치 · {curLabel}</h3>
          <span className="sub">방법별 결과와 그 중앙값</span>
        </div>
        <div className="grid grid-tiles">
          <Tile
            label="중앙값"
            value={v.median}
            unit={`${full(Math.round(v.median))}원`}
            hint={
              v.methods.some((m) => m.key === 'round')
                ? '장부가 기반 방법들과 투자 발행가 기준을 함께 놓고 낸 중앙값입니다. 성격이 다른 값이 섞여 있습니다.'
                : '아래 방법들의 중앙값'
            }
          />
          <Tile label="가장 낮은 추정" value={v.range.min} unit={`${full(Math.round(v.range.min))}원`} />
          <Tile label="가장 높은 추정" value={v.range.max} unit={`${full(Math.round(v.range.max))}원`} />
          {v.issuedShares && (
            <Tile
              label="보통주 1주당 (중앙값)"
              value={`${Math.round(v.median / v.issuedShares).toLocaleString('ko-KR')}원`}
              unit={`보통주 ${full(v.issuedShares)}주`}
            />
          )}
        </div>
      </section>

      {v.shareCounts.preferred > 0 && (
        <Callout>
          <span>
            이 회사의 발행주식은 <strong>보통주 {full(v.shareCounts.common)}주 + 상환전환우선주{' '}
            {full(v.shareCounts.preferred)}주 = 총 {full(v.shareCounts.total)}주</strong>입니다.
            상환전환우선주는 회계상 <strong>부채</strong>라 자본총계에서 이미 빠져 있어, 위 방법들이 내놓는 값은
            보통주 몫입니다. 그래서 1주당 값도 보통주 수로 나눴습니다.
            {v.shareCounts.potential > 0 && (
              <> 주식선택권 {full(v.shareCounts.potential)}주까지 더한 완전희석 주식수는{' '}
              {full(v.shareCounts.diluted)}주입니다.</>
            )}
          </span>
        </Callout>
      )}

      <Card title="방법별 계산" sub="가정과 산식을 그대로 드러냅니다" tight>
        <FinTable
          minWidth={720}
          columns={[
            { key: 'value', label: '추정 기업가치' },
            { key: 'perShare', label: '1주당', render: (x) => (x == null ? '-' : `${Math.round(x).toLocaleString('ko-KR')}원`) },
            { key: 'basis', label: '산식' },
          ]}
          rows={v.methods.map((m) => ({
            label: m.label,
            level: 0,
            values: {
              value: m.value,
              perShare: m.perShare ?? (v.issuedShares ? m.value / v.issuedShares : null),
              basis: m.basis,
            },
          }))}
          note="1주당 값은 보통주 수로 나눈 값입니다. 발행가 기준은 총 발행주식수(우선주 포함)로 계산합니다."
        />
        <div style={{ padding: 'clamp(12px, 2vw, 20px)', borderTop: '1px solid var(--border)', display: 'grid', gap: 12 }}>
          {v.methods.map((m) => (
            <div key={m.key} style={{ fontSize: 13 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>{m.label}</strong>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{abbrev(m.value)}</span>
                {m.adjustable && <Badge tone="info">배수 조정 가능</Badge>}
                {m.asOf && <Badge tone="warn">{m.asOf} 기준</Badge>}
              </div>
              <div style={{ color: 'var(--text-3)', marginTop: 2 }}>{m.detail}</div>
              {m.note && <div style={{ color: 'var(--text-2)', marginTop: 4 }}>{m.note}</div>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="배수 조정" sub="동종업계 수준을 알고 있다면 직접 넣어 보세요">
        <div className="grid">
          {KNOBS.map((k) => (
            <label key={k.key} style={{ display: 'grid', gap: 6, fontSize: 13 }}>
              <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{k.label}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{multiples[k.key]}</strong>
              </span>
              <input
                type="range"
                min={k.min}
                max={k.max}
                step={k.step}
                value={multiples[k.key]}
                onChange={(e) => setMultiples((m) => ({ ...m, [k.key]: Number(e.target.value) }))}
                style={{ width: '100%', accentColor: SERIES[0] }}
              />
            </label>
          ))}
        </div>
        <button className="btn btn-sm btn-ghost" type="button" onClick={() => setMultiples(DEFAULT_MULTIPLES)} style={{ marginTop: 12 }}>
          기본값으로
        </button>
      </Card>

      <Card title="계산에 쓴 값" tight>
        <FinTable
          columns={[{ key: 'v', label: curLabel }]}
          rows={[
            { label: '자본총계 (순자산)', level: 0, values: { v: v.inputs.equity } },
            { label: '당기순이익', level: 0, values: { v: v.inputs.netIncome } },
            { label: '영업이익', level: 0, values: { v: v.inputs.operating } },
            { label: '자산총계', level: 1, values: { v: v.inputs.assets } },
            { label: '부채총계', level: 1, values: { v: v.inputs.liabilities } },
            { label: '차입금 (단기+장기)', level: 1, values: { v: v.inputs.debt } },
            { label: '현금및현금성자산', level: 1, values: { v: v.inputs.cash } },
            { label: '보통주', level: 1, values: { v: v.shareCounts.common } },
            ...(v.shareCounts.preferred
              ? [
                  { label: '상환전환우선주', level: 1, values: { v: v.shareCounts.preferred } },
                  { label: '총 발행주식수', level: 0, values: { v: v.shareCounts.total } },
                ]
              : []),
            ...(v.shareCounts.potential
              ? [
                  { label: '주식선택권 (잠재주식)', level: 1, values: { v: v.shareCounts.potential } },
                  { label: '완전희석 주식수', level: 1, values: { v: v.shareCounts.diluted } },
                ]
              : []),
          ]}
        />
      </Card>
    </div>
  )
}
