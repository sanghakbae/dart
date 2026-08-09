import { Card, Callout, Badge, Tile } from './ui'
import { computeRunway, runwayText } from '../lib/analyze/runway'
import { full, abbrev } from '../lib/format'

/**
 * 런웨이 — 지금 속도로 현금을 태우면 몇 개월 버티는가.
 *
 * 재무비율은 "영업이익률이 몇 %"까지만 답한다. 적자 회사를 볼 때 실제로 묻는 것은
 * "언제 돈이 떨어지나"라서, 그 한 줄을 지표보다 먼저 보여 준다.
 * 현금을 태우지 않는 회사에는 아무것도 그리지 않는다 — 없는 위험을 만들지 않는다.
 */
/**
 * 이 개월 수를 넘으면 카드를 그리지 않는다.
 * 현금 198억에 연 소진 15억인 회사에 "런웨이 12.6년" 을 띄우면 없는 위험을 만든다.
 * (점검 탭에는 그대로 남아 있으니 정보가 사라지는 것은 아니다)
 */
const SHOW_BELOW_MONTHS = 36

export default function RunwayCard({ report }) {
  const rw = computeRunway(report?.values)
  if (!rw.burning || rw.months == null || rw.months >= SHOW_BELOW_MONTHS) return null

  const tone = rw.band?.tone || 'info'
  const basisLabel = rw.basis === 'free' ? '영업 + 투자' : '영업'
  const burn = rw.basis === 'free' ? rw.burnFree : rw.burnOperating

  return (
    <Card
      title="런웨이"
      sub="지금 소진 속도로 현금이 언제 바닥나는지"
      right={<Badge tone={tone} dot>{rw.band?.label}</Badge>}
    >
      <div className="grid grid-tiles">
        <Tile label="남은 기간" value={runwayText(rw.months)} unit={`${basisLabel} 기준`} />
        <Tile
          label="보유 현금"
          value={abbrev(rw.cash)}
          unit={`${full(rw.cash)}원`}
        />
        <Tile label="연 소진액" value={abbrev(burn)} unit={`${full(burn)}원`} />
        <Tile label="월 소진액" value={abbrev(Math.round(burn / 12))} unit={`${full(Math.round(burn / 12))}원`} />
      </div>

      {/* 기준이 두 개인 이유를 밝힌다 — 하나만 보면 반드시 오해한다. */}
      {rw.monthsOperating != null && rw.monthsFree != null && rw.monthsOperating !== rw.monthsFree && (
        <Callout>
          기준에 따라 <strong>영업만 보면 {runwayText(rw.monthsOperating)}</strong>,
          {' '}<strong>설비·개발 투자까지 넣으면 {runwayText(rw.monthsFree)}</strong>입니다.
          짧은 쪽을 위에 적었습니다.
        </Callout>
      )}

      <Callout tone={rw.months < 12 ? 'warn' : undefined}>
        보유 현금은 현금및현금성자산
        {rw.deposits ? <> 에 단기금융상품 {abbrev(rw.deposits)}원을 더한 값</> : ''}입니다.
        <strong> 증자·차입이 없다는 전제</strong>라 실제로는 이보다 길어질 수 있고, 소진 속도가
        빨라지면 짧아집니다. 결론이 아니라 확인할 지점입니다.
      </Callout>
    </Card>
  )
}
