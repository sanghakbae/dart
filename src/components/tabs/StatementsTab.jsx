import { useState } from 'react'
import { Card, FinTable, Empty, Badge, Disclose, Seg } from '../ui'
import { CompositionDonut, ProfitWaterfall } from '../charts'
import { comparisonRows, assetSlices, liabilitySlices, equitySlices, waterfallSteps } from '../../lib/analyze/view'
import { STATEMENTS } from '../../lib/parse/taxonomy'
import { accounting, signedPct } from '../../lib/format'

export default function StatementsTab({ report, blocks, loading }) {
  const [only, setOnly] = useState('recognized')
  const periods = report.periods || []
  const curLabel = periods[0]?.label || '당기'
  const priLabel = periods[1]?.label || '전기'

  if (loading) return <Card><Empty title="원문 표를 불러오는 중입니다…" /></Card>
  if (!blocks?.length) {
    return (
      <Card>
        <Empty title="재무제표 표를 찾지 못했습니다">
          텍스트 레이어가 없는 스캔 PDF이거나, 표 서식이 특이한 문서일 수 있습니다. 원문 탭에서 추출된 텍스트를 확인해 보세요.
        </Empty>
      </Card>
    )
  }

  const order = ['BS', 'IS', 'CI', 'CF', 'CE']
  const sorted = [...blocks].sort((a, b) => order.indexOf(a.stmt) - order.indexOf(b.stmt) || b.matchCount - a.matchCount)
  const values = report.values || {}

  return (
    <div className="stack-lg">
      <Card title="재무제표 원문" sub={`${blocks.length}개 표 블록을 인식했습니다`}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Seg
            ariaLabel="표시 범위"
            value={only}
            onChange={setOnly}
            options={[
              { value: 'recognized', label: '인식된 계정' },
              { value: 'all', label: '원문 전체 행' },
            ]}
          />
          <span className="sub" style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
            ‘원문 전체 행’은 계정과목으로 매칭되지 않은 줄까지 문서에 나온 순서 그대로 보여줍니다.
          </span>
        </div>
      </Card>

      {sorted.map((b) => (
        <BlockCard key={b.id} block={b} mode={only} curLabel={curLabel} priLabel={priLabel} />
      ))}

      <div className="grid grid-wide">
        <CompositionDonut title={`자산 구성 · ${curLabel}`} slices={assetSlices(values)} note="상위 6개 항목까지 표시하고 나머지는 기타로 묶습니다." />
        <CompositionDonut title={`자본 구성 · ${curLabel}`} slices={equitySlices(values)} />
      </div>
      <div className="grid grid-wide">
        <CompositionDonut title={`부채 구성 · ${curLabel}`} slices={liabilitySlices(values)} />
        <ProfitWaterfall title={`손익 구조 · ${curLabel}`} steps={waterfallSteps(values)} />
      </div>
    </div>
  )
}

function BlockCard({ block, mode, curLabel, priLabel }) {
  const items = block.items || []
  const rows = block.rows || []
  const cmp = comparisonRows(items)
  const unitNote = block.unit?.found
    ? `원문 표기 단위: ${block.unit.label} → 원 단위로 환산해 표시`
    : '원문에 단위 표기가 없어 원 단위로 봤습니다'

  const columns =
    mode === 'recognized'
      ? [
          { key: 'current', label: curLabel },
          { key: 'prior', label: priLabel },
          { key: 'diff', label: '증감' },
          { key: 'rate', label: '증감률', render: (v) => signedPct(v) },
        ]
      : maxCols(rows).map((i) => ({ key: `c${i}`, label: i === 0 ? curLabel : i === 1 ? priLabel : `값 ${i + 1}` }))

  const tableRows =
    mode === 'recognized'
      ? cmp
      : rows
          .filter((r) => r.kind !== 'blank')
          .map((r) => {
            const vals = r.scaled || r.values || []
            return {
              label: r.label || (r.kind === 'numbersOnly' ? '(라벨 없음)' : '—'),
              level: r.kind === 'header' ? 0 : 1,
              isSum: r.kind === 'header',
              // 숫자가 없는 줄은 값 칸을 '-' 로 채우지 않고 한 줄짜리 소제목으로 표시한다.
              span: vals.length === 0,
              values: Object.fromEntries(vals.map((v, i) => [`c${i}`, v])),
            }
          })

  return (
    <Card
      title={`${block.label}`}
      sub={`${block.page ? `${block.page}p · ` : ''}인식 계정 ${block.matchCount}개 · 원문 ${rows.length}행`}
      right={<Badge tone={block.basis === '연결' ? 'info' : 'muted'}>{block.basis}</Badge>}
      tight
    >
      {tableRows.length ? (
        <FinTable columns={columns} rows={tableRows} note={unitNote} minWidth={Math.max(560, 160 + columns.length * 120)} />
      ) : (
        <Empty title="이 블록에서 숫자를 찾지 못했습니다" />
      )}
      <Disclose summary="이 표의 원문 텍스트 그대로 보기" count={`${rows.length}행`}>
        <div className="raw">
          {rows.map((r, i) => `${r.label}${r.values?.length ? `\t${r.values.map((v) => accounting(v)).join('\t')}` : ''}`).join('\n')}
        </div>
      </Disclose>
    </Card>
  )
}

/**
 * 값 칸 개수는 최댓값이 아니라 '가장 흔한 개수'로 잡는다.
 * 셀 분리가 어긋난 한두 줄 때문에 모든 줄에 빈 칸이 생기는 것을 막는다.
 */
function maxCols(rows) {
  const freq = new Map()
  for (const r of rows) {
    const n = (r.scaled || r.values || []).length
    if (n > 0) freq.set(n, (freq.get(n) || 0) + 1)
  }
  if (!freq.size) return [0, 1]
  const dominant = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
  return Array.from({ length: Math.min(dominant, 8) }, (_, i) => i)
}
