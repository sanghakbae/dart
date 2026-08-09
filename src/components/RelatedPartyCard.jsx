import { Card, Callout, Badge, Empty, NoteBody, Tile } from './ui'
import { extractRelatedParty, extractContingencies } from '../lib/analyze/related'
import { abbrev, full, pctText } from '../lib/format'

/**
 * 특수관계자 거래 · 우발상황.
 *
 * 둘 다 재무제표 본문에는 안 나오고 주석에만 있다. 지금까지는 주석 원문을 눈으로
 * 읽어야 했다 — 투자 실사에서 반드시 보는 항목이라 따로 꺼내 둔다.
 *
 * 숫자는 단정하지 않는다. 주석 표는 셀 병합이 많아 합계가 어긋날 수 있어,
 * 계산 근거가 된 원문 표를 항상 아래에 함께 보여 준다.
 */
export default function RelatedPartyCard({ report, notes }) {
  const src = notes?.items ? notes : report?.notes
  const rel = extractRelatedParty(src, report?.values?.revenue?.current)
  const con = extractContingencies(src)
  if (!rel && !con) return null

  return (
    <>
      {rel && (
        <Card
          title="특수관계자 거래"
          sub={`주석 ${rel.no}. ${rel.title}`}
          right={
            rel.share != null ? (
              <Badge tone={rel.heavy ? 'warn' : 'muted'} dot>
                매출의 최소 {pctText(rel.share)}
              </Badge>
            ) : null
          }
        >
          {rel.revenueFromRelated != null ? (
            <>
              <div className="grid grid-tiles">
                <Tile
                  label="확인된 특수관계자 매출"
                  value={abbrev(rel.revenueFromRelated)}
                  unit={`${full(rel.revenueFromRelated)}원 · 최소치`}
                />
                <Tile label="총 매출" value={abbrev(rel.revenue)} unit={`${full(rel.revenue)}원`} />
                <Tile label="매출 내 비중" value={`최소 ${pctText(rel.share)}`} />
                <Tile label="집계된 행" value={rel.counterparties.length} suffix="건" />
              </div>

              {rel.heavy && (
                <Callout tone="warn">
                  매출의 <strong>최소 {pctText(rel.share)}</strong> 가 특수관계자에서 나옵니다. 그만큼은 시장에서
                  얻은 매출이 아니라 <strong>그룹 안에서 배분된 것</strong>일 수 있어, 관계가 끊기면 함께
                  사라집니다. 거래 조건이 시장가인지 주석에서 확인하세요.
                </Callout>
              )}

              <Callout tone="warn">
                <strong>이 값은 하한입니다.</strong> 주석 표는 회사마다 모양이 달라, 행 이름이 계정과목이 아니라
                회사명으로만 적힌 표는 집계하지 못합니다. 실제 비중은 이보다 클 수 있으니
                <strong> 반드시 아래 원문 표로 확인</strong>하세요.
              </Callout>

              <Callout>
                {rel.method === 'column'
                  ? '열 제목에 ‘매출’ 이 들어간 열만 더했습니다.'
                  : '계정과목이 ‘매출·수익’ 인 행의 당기 값만 더했습니다.'}
                {' '}배당금수익·매입처럼 성격이 다른 항목과 채권·채무 표는 뺐고, 주석에 적힌 단위(천원 등)로
                환산했습니다. 단위를 못 찾은 표는 아예 더하지 않습니다.
              </Callout>
            </>
          ) : (
            <Callout>
              이 주석에서 <strong>매출 성격의 표를 찾지 못했습니다</strong>. 거래가 없다는 뜻이 아니라
              표 모양이 달라 합산하지 못한 것일 수 있으니 아래 원문을 보세요.
            </Callout>
          )}

          <div style={{ marginTop: 14 }}>
            <NoteBody content={rel.tables.length ? rel.tables : undefined} body={rel.body} />
          </div>
        </Card>
      )}

      {con && (
        <Card
          title="우발상황 · 약정"
          sub={con.notes.map((n) => `주석 ${n.no}. ${n.title}`).join(' · ')}
          right={
            <Badge tone={con.present.length ? 'warn' : 'good'} dot>
              {con.present.length ? `${con.present.length}건 확인` : '해당 없음'}
            </Badge>
          }
        >
          {con.present.length > 0 ? (
            <>
              <Callout tone="warn">
                아래는 <strong>재무상태표에 부채로 잡히지 않는</strong> 항목입니다. 금액이 확정되지 않았을 뿐
                실제로 부담이 될 수 있어, 투자 판단에서는 부채와 함께 봐야 합니다.
              </Callout>
              <ul className="cont-list">
                {con.present.map((c, i) => (
                  <li key={i}>
                    <Badge tone="warn">{c.kind}</Badge>
                    <span>{c.text}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <Callout>
              소송·지급보증·담보제공에 해당하는 내용을 찾지 못했습니다.
              {con.absent.length > 0 && (
                <> 주석에는 <strong>“없다”고 명시</strong>되어 있습니다 — 아래 원문에서 확인하세요.</>
              )}
            </Callout>
          )}

          {con.absent.length > 0 && (
            <ul className="cont-list muted">
              {con.absent.map((c, i) => (
                <li key={i}>
                  <Badge tone="good">{c.kind} 없음</Badge>
                  <span>{c.text}</span>
                </li>
              ))}
            </ul>
          )}

          <div style={{ marginTop: 14 }}>
            {con.notes.map((n) => (
              <div key={n.no} style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: 15 }}>{n.no}. {n.title}</strong>
                <NoteBody content={n.content?.length ? n.content : undefined} body={n.body} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
