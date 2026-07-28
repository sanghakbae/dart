import { Card, Tile, Badge, Insight, Callout, KV, FinTable, Empty, Disclose, NoteBody } from '../ui'
import { AmountTrend, GrowthBars, StructureStack, ProfitWaterfall, CompositionDonut, SERIES } from '../charts'
import { headlineTiles, growthRows, waterfallSteps, assetSlices } from '../../lib/analyze/view'
import { seriesFor } from '../../lib/analyze/series'
import { full, abbrev, dateText, fileSize, signedPct, pctText } from '../../lib/format'

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
                worseWhenUp={t.worseWhenUp}
              />
            ))}
          </div>
        ) : (
          <Card><Empty title="주요 지표를 인식하지 못했습니다">재무제표 탭에서 인식된 원문 표를 직접 확인할 수 있습니다.</Empty></Card>
        )}
      </section>

      <ShareCard shares={report.shares} notes={report.notes} curLabel={curLabel} />

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


/** 주석 번호로 표 구조가 살아 있는 본문 블록을 찾는다. */
function noteContentOf(notes, no) {
  const hit = (notes?.items || []).find((n) => n.no === no)
  return hit?.content || null
}

/**
 * 주주 · 주식 정보. 감사보고서는 지분 현황을 표로 싣지 않고 주석에 흩어 놓으므로,
 * 뽑아낸 수치와 함께 근거가 된 주석 본문을 그대로 붙여 둔다.
 */
function ShareCard({ shares, notes, curLabel }) {
  if (!shares?.found) return null
  const { majorShareholder: major, executives = [], sourceNotes = [] } = shares

  return (
    <Card
      title={`주주 · 주식 · ${curLabel}`}
      sub="주석에서 추출한 지분 정보"
      right={
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {shares.hasStockOption && <Badge tone="info">주식선택권</Badge>}
          {shares.hasPreferred && <Badge tone="muted">종류주식</Badge>}
        </div>
      }
    >
      <div className="grid grid-tiles">
        {major && (
          <Tile
            label="최대주주"
            value={major.name}
            unit={major.shares != null ? `${full(major.shares)}주` : undefined}
            hint={major.raw}
          />
        )}
        {/* 보고서마다 분모가 달라(보통주만 / 우선주 포함) 해를 나란히 놓으면
            지분이 오르내린 것처럼 보인다. 두 기준을 함께 낸다. */}
        {major?.ratio != null && (
          <Tile
            label={`최대주주 지분율${major.statedBasis === 'total' ? ' (총주식수 기준)' : major.statedBasis === 'common' ? ' (보통주 기준)' : ''}`}
            value={pctText(major.ratio)}
            unit={
              major.ratioTotal != null && major.ratioCommon != null && Math.abs(major.ratioCommon - major.ratioTotal) > 0.15
                ? `보통주 ${pctText(major.ratioCommon)} · 총주식수 ${pctText(major.ratioTotal)}`
                : undefined
            }
            hint={
              major.ratioTotal != null && major.ratioCommon != null && Math.abs(major.ratioCommon - major.ratioTotal) > 0.15
                ? '상환전환우선주를 분모에 넣느냐에 따라 달라집니다. 보고서마다 기준이 달라 연도별로 비교할 때 주의해야 합니다.'
                : undefined
            }
          />
        )}
        {shares.issuedShares != null && (
          <Tile
            label={shares.preferredHidden ? '보통주' : '발행주식수'}
            value={abbrev(shares.issuedShares)}
            unit={`${full(shares.issuedShares)}주`}
            delta={
              shares.issuedSharesPrior
                ? ((shares.issuedShares - shares.issuedSharesPrior) / shares.issuedSharesPrior) * 100
                : null
            }
            deltaLabel="vs 전기"
          />
        )}
        {/* 우선주는 부채로 잡혀 자본금 주석에 없다. 따로 세지 않으면 화면에서 통째로 사라진다. */}
        {shares.preferredShares != null && (
          <Tile
            label="상환전환우선주"
            value={abbrev(shares.preferredShares)}
            unit={`${full(shares.preferredShares)}주`}
            tone="warn"
          />
        )}
        {shares.totalShares != null && shares.preferredHidden && (
          <Tile
            label="총 발행주식수"
            value={abbrev(shares.totalShares)}
            unit={`${full(shares.totalShares)}주 · 등기부 기준`}
          />
        )}
        {shares.authorizedShares != null && (
          <Tile label="수권주식수" value={abbrev(shares.authorizedShares)} unit={`${full(shares.authorizedShares)}주`} />
        )}
        {shares.treasuryShares != null && (
          <Tile label="자기주식" value={abbrev(shares.treasuryShares)} unit={`${full(shares.treasuryShares)}주`} />
        )}
      </div>

      {shares.capitalChanges?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>자본금 변동</h4>
          <FinTable
            columns={[
              { key: 'shares', label: '주식수 변동' },
              { key: 'capital', label: '자본금 변동' },
              { key: 'kind', label: '성격' },
            ]}
            rows={shares.capitalChanges.map((c) => ({
              label: c.label,
              level: 1,
              values: {
                shares: c.shares,
                capital: c.capital,
                // 무상증자와 액면분할은 둘 다 주식수를 늘리지만 성격이 다르다.
                // 뭉쳐 보면 "몇 배 늘었다" 만 남아 잘못 읽게 된다.
                kind: c.capitalMoved ? '잉여금 자본전입' : '액면가 분할 (자본금 불변)',
              },
            }))}
            note="주식수가 늘어난 사유입니다. 자본금이 함께 늘었으면 무상증자, 그대로면 액면분할입니다."
          />
        </div>
      )}

      {shares.stockOptions?.grants?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>
            주식선택권 <span className="tnote">잠재주식 {full(shares.stockOptions.potentialShares)}주</span>
          </h4>
          <FinTable
            columns={[
              { key: 'exercisable', label: '행사가능 주식수' },
              { key: 'strike', label: '행사가격' },
              { key: 'grantDate', label: '부여일' },
            ]}
            rows={shares.stockOptions.grants.map((g) => ({
              label: g.round,
              level: 1,
              values: { exercisable: g.exercisable ?? g.granted, strike: g.strike, grantDate: g.grantDate || '-' },
            }))}
            note="모두 행사되면 그만큼 주식수가 늘어납니다(완전희석)."
          />
        </div>
      )}

      {executives.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>임원 보유 주식</h4>
          <FinTable
            columns={[
              { key: 'role', label: '직위' },
              { key: 'shares', label: '보유 주식수' },
              { key: 'ratio', label: '지분율', render: (v) => (v == null ? '-' : pctText(v)) },
            ]}
            rows={executives.map((e) => ({
              label: e.name,
              level: 1,
              values: { role: e.role || '-', shares: e.shares, ratio: e.ratio },
            }))}
            note="주석 본문에서 인식한 내용입니다. 감사보고서에 임원별 지분 표가 없으면 대표이사 등 언급된 인물만 나옵니다."
          />
        </div>
      )}

      {shares.shareholders?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>주주 구성</h4>
          <FinTable
            columns={[
              { key: 'shares', label: '주식수' },
              { key: 'ratio', label: '지분율', render: (v) => (v == null ? '-' : pctText(v)) },
            ]}
            rows={shares.shareholders.map((s) => ({ label: s.name, level: 1, values: { shares: s.shares, ratio: s.ratio } }))}
          />
        </div>
      )}

      {sourceNotes.length > 0 && (
        <div style={{ marginTop: 16, borderTop: '1px solid var(--border)' }}>
          {sourceNotes.map((n) => (
            <Disclose key={n.no} summary={`근거 주석 ${n.no}. ${n.title}`} count={`${(n.body || '').length.toLocaleString('ko-KR')}자${n.page ? ` · ${n.page}p` : ''}`}>
              {/* 표 구조는 주석 데이터에서 번호로 찾아 쓴다(요약 문서에는 중첩 배열을 담지 않는다) */}
              <NoteBody content={noteContentOf(notes, n.no)} body={n.body} muted />
            </Disclose>
          ))}
        </div>
      )}
    </Card>
  )
}
