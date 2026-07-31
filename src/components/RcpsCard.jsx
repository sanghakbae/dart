import { Card, Tile, Callout, Badge, FinTable } from './ui'
import { abbrev, full } from '../lib/format'
import { redemptionAt } from '../lib/parse/rcps'

/**
 * 상환전환우선주 라운드.
 *
 * 비상장 법인은 투자 유치를 공시할 의무가 없어 DART 에는 아무것도 없다.
 * 그런데 감사보고서 주석에는 발행가·주식수·발행일·상환조건이 전부 적혀 있다 —
 * 사실상 유일한 라운드 정보다. 여기서 그걸 그대로 펼친다.
 *
 * 시점을 반드시 함께 보여준다. 무하유의 이 라운드는 2023년 10월이라
 * '현재 기업가치' 가 아니다.
 */
export default function RcpsCard({ rcps, shares }) {
  if (!rcps?.found) return null

  const total = shares?.totalShares ?? null
  const postMoney = rcps.issuePrice != null && total ? rcps.issuePrice * total : null
  const rate = rcps.statedRate ?? rcps.impliedRate
  const putDue = daysUntil(rcps.putStartDate)
  const putAmount = redemptionAt(rcps, rcps.putAfterYears)
  // 조항 표는 가장 최근 라운드 기준으로 보여준다(요약값도 그쪽을 따른다).
  const latest = rcps.series.find((s) => s.issueDate === rcps.issueDate) || rcps.series[0] || null

  return (
    <Card
      title="상환전환우선주 (주석)"
      sub={rcps.issueDate ? `${rcps.issueDate} 발행` : '감사보고서 주석에서 인식'}
      right={<Badge tone="info">감사보고서 주석</Badge>}
    >
      <div className="stack">
        <Callout>
          비상장 법인은 투자 유치를 공시할 의무가 없어 DART 에 나타나지 않습니다. 아래는{' '}
          <strong>감사보고서 주석에서 읽은 실제 발행 조건</strong>입니다.
        </Callout>

        <div className="grid grid-tiles">
          <Tile label="조달금액" value={rcps.raised} unit={rcps.raised ? `${full(rcps.raised)}원` : undefined} />
          {rcps.issuePrice != null && (
            <Tile
              label={rcps.splitRatio ? '주당발행가액 (환산)' : '주당발행가액'}
              value={`${full(rcps.issuePrice)}원`}
              unit={rcps.shares ? `${full(rcps.shares)}주` : undefined}
              hint={
                rcps.splitRatio
                  ? `무상증자·액면분할로 주식이 ${rcps.splitRatio}배가 된 뒤 기준으로 환산한 값입니다. 투자자가 실제로 낸 단가는 아닙니다.`
                  : undefined
              }
            />
          )}
          {/* 환산가만 내놓으면 투자자가 그 값에 샀다고 읽힌다. 실제로 낸 단가를 함께 낸다. */}
          {rcps.splitRatio && rcps.issuePrice != null && (
            <Tile
              label="발행 당시 단가"
              value={`${full(rcps.issuePrice * rcps.splitRatio)}원`}
              unit={rcps.originalShares ? `${full(rcps.originalShares)}주 · 분할 전` : '분할 전'}
              tone="info"
            />
          )}
          {postMoney != null && !rcps.mixedPrices && (
            <Tile
              label="발행가 기준 기업가치"
              value={postMoney}
              unit={`${full(rcps.issuePrice)}원 × ${full(total)}주`}
              hint={rcps.issueDate ? `${rcps.issueDate} 기준입니다. 그 뒤 실적은 반영돼 있지 않습니다.` : undefined}
            />
          )}
          {rate != null && (
            <Tile
              label="보장 수익률"
              value={`연 ${rate}%`}
              unit={rcps.termYears ? `복리 · 존속 ${rcps.termYears}년` : '복리'}
              tone="warn"
            />
          )}
        </div>

        {/* 배당 0% 를 보고 '무배당이라 부담이 없다' 고 읽으면 정반대다.
            상환할증금이 수익률을 대신하고, 그 금액이 이미 부채로 쌓여 있다. */}
        {rcps.liability?.premium != null && rcps.liability?.face != null && (
          <Callout tone="warn">
            <span>
              배당은 <strong>{rcps.dividend || '액면 기준 0%'}</strong>지만, 상환할증금{' '}
              <strong>{abbrev(rcps.liability.premium)}</strong>이 그 자리를 대신합니다. 원금{' '}
              {abbrev(rcps.liability.face)}에{' '}
              {rate != null ? <><strong>연복리 {rate}%</strong>를 붙여</> : '할증을 붙여'} 상환하는 구조라
              {rcps.maturityDate && <> 만기({rcps.maturityDate})에는 {abbrev(rcps.liability.face + rcps.liability.premium)}이 됩니다.</>}
            </span>
          </Callout>
        )}

        {rcps.putStartDate && (
          <Callout tone={putDue != null && putDue < 365 ? 'critical' : 'warn'}>
            <span>
              <strong>상환청구가 {rcps.putStartDate}부터 열립니다</strong>
              {putDue != null && (putDue <= 0 ? ' — 이미 열려 있습니다.' : ` — ${putDue}일 남았습니다.`)}{' '}
              {putAmount != null && <>그 시점 상환금액은 <strong>{abbrev(putAmount)}</strong>입니다. </>}
              {rcps.liability?.allCurrent && '재무제표에도 전액 유동부채로 옮겨져 있습니다.'}
            </span>
          </Callout>
        )}

        {/* 파생상품 평가손익은 영업과 무관하게 순이익을 흔든다. 회사가 그걸 뺀
            이익을 직접 밝혀 두는 경우가 많아 그대로 옮긴다. */}
        {rcps.pnl?.pretaxExDerivative != null && (
          <Callout>
            <span>
              RCPS 파생상품 평가손익 때문에 순이익이 흔들립니다. 회사가 밝힌 바로는 당기 세전이익{' '}
              <strong>{abbrev(rcps.pnl.pretax)}</strong>에서 파생금융상품 평가손실{' '}
              <strong>{abbrev(rcps.pnl.derivativeLoss)}</strong>을 제외하면{' '}
              <strong>{abbrev(rcps.pnl.pretaxExDerivative)}</strong>입니다.
              현금이 오간 손실이 아니고, 전환되면 사라집니다.
            </span>
          </Callout>
        )}

        {rcps.splitRatio && (
          <Callout>
            <span>
              이 라운드 뒤 <strong>무상증자·액면분할로 주식이 {rcps.splitRatio}배</strong>가 됐습니다. 주석의
              발행가 {full(rcps.issuePrice)}원은 그 기준으로 환산한 값이고, 투자자가{' '}
              {rcps.issueDate || '발행 당시'}에 실제로 낸 단가는{' '}
              <strong>주당 {full(rcps.issuePrice * rcps.splitRatio)}원</strong>
              {rcps.originalShares && <> ({full(rcps.originalShares)}주)</>}입니다. 총 투자금과 지분율은 어느
              쪽으로 계산해도 같습니다.
            </span>
          </Callout>
        )}

        {rcps.mixedPrices && (
          <Callout tone="warn">
            종류마다 발행가가 달라 대표 단가 하나로 기업가치를 매기지 않았습니다.
            아래 종류별 발행가와 주식수를 직접 보고 판단해 주세요.
          </Callout>
        )}

        {rcps.series.length > 1 && (
          <FinTable
            columns={[
              { key: 'price', label: '주당발행가액' },
              { key: 'shares', label: '발행주식수' },
              { key: 'date', label: '발행일' },
            ]}
            rows={rcps.series.map((s) => ({
              label: s.name,
              level: 1,
              values: { price: s.issuePrice, shares: s.shares, date: s.issueDate || '-' },
            }))}
            note="종류주식이 여럿입니다. 조달금액은 종류별로 곱해 더한 값입니다."
          />
        )}

        <FinTable
          columns={[{ key: 'v', label: '내용', align: 'left' }]}
          rows={[
            { label: '종류', level: 0, values: { v: latest?.name || '상환전환우선주' } },
            { label: '발행일', level: 1, values: { v: rcps.issueDate || '-' } },
            { label: '존속기간', level: 1, values: { v: latest?.term || '-' } },
            { label: '배당', level: 1, values: { v: rcps.dividend || '-' } },
            { label: '전환비율', level: 1, values: { v: rcps.conversionRatio || '-' } },
            { label: '전환비율 조정 (리픽싱)', level: 1, values: { v: rcps.refixing || '없음' } },
            { label: '상환청구 기간', level: 1, values: { v: rcps.putPeriod || '-' } },
            { label: '상환금액', level: 1, values: { v: rcps.redemption || '-' } },
          ]}
          note="주석 표를 그대로 옮긴 것입니다."
        />

        <div>
          <h4 style={{ fontSize: 13.5, marginBottom: 8 }}>재무제표에 잡힌 금액</h4>
          <FinTable
            columns={[{ key: 'v', label: '당기말' }]}
            rows={[
              { label: '상환전환우선주부채 (부채요소)', level: 1, values: { v: rcps.liability?.carrying } },
              { label: '파생상품부채 (전환권·조기상환권)', level: 1, values: { v: rcps.derivative?.current } },
              { label: '합계', level: 0, values: { v: rcps.totalLiability } },
              ...(rcps.accretion
                ? [{ label: '당기 이자비용 (전환권조정 상각)', level: 1, values: { v: rcps.accretion.current } }]
                : []),
            ]}
            note={
              '부채요소만 보면 절반도 안 보입니다. 전환권·조기상환권은 파생상품부채로 따로 잡히는데 대개 이쪽이 더 큽니다. ' +
              '이자비용은 현금이 나가지 않지만 당기순이익을 그만큼 깎습니다.'
            }
          />
        </div>
      </div>
    </Card>
  )
}

/** 오늘부터 그 날짜까지 남은 일수. 지났으면 0 이하. */
function daysUntil(date) {
  if (!date) return null
  const t = Date.parse(`${date}T00:00:00`)
  if (!Number.isFinite(t)) return null
  return Math.round((t - Date.now()) / 86_400_000)
}
