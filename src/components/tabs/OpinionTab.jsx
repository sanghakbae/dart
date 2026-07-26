import { Card, Badge, Callout, Disclose, Empty, KV, Prose, NoteBody } from '../ui'
import { dateText } from '../../lib/format'

const VERDICT_HELP = {
  unqualified: '재무제표가 회계기준에 따라 중요성의 관점에서 공정하게 표시되었다는 의견입니다.',
  qualified: '일부 항목을 제외하면 공정하게 표시되었다는 의견입니다. 제외 사유를 반드시 확인해야 합니다.',
  adverse: '재무제표가 공정하게 표시되지 않았다는 의견입니다. 심각한 신호입니다.',
  disclaimer: '감사 범위가 제한되어 의견을 표명하지 않았습니다. 심각한 신호입니다.',
  unknown: '문서에서 감사의견 문단을 찾지 못했습니다. 재무제표만 담긴 파일일 수 있습니다.',
}

/** 절 원문에서 표·목차 구조를 살린 블록을 찾아온다(없으면 문단으로 표시). */
function sectionContent(list, keys) {
  for (const k of keys) {
    const s = (list || []).find((x) => x.key === k)
    if (s?.content?.length) return s.content
  }
  return null
}

export default function OpinionTab({ report, sections, loading }) {
  const { opinion, goingConcern, kam, emphasis, other, internalControl, meta } = report
  const list = sections || report.sections || []

  return (
    <div className="stack-lg">
      <Card
        title="감사의견"
        right={<Badge tone={opinion?.tone} dot>{opinion?.label || '판정 불가'}</Badge>}
      >
        <Callout tone={opinion?.tone === 'critical' ? 'bad' : opinion?.tone === 'warn' ? 'warn' : undefined}>
          {VERDICT_HELP[opinion?.type] || VERDICT_HELP.unknown}
        </Callout>
        <div style={{ marginTop: 14 }}>
          <KV
            items={[
              { k: '감사인', v: meta.auditor || '미확인' },
              { k: '감사보고서일', v: dateText(meta.reportDate) },
              { k: '업무수행이사', v: report.auditPartner || '미확인' },
              { k: '대상 재무제표', v: `${meta.basis}재무제표` },
            ]}
          />
        </div>
        {opinion?.text ? (
          <div style={{ marginTop: 14 }}><Prose text={opinion.text} /></div>
        ) : (
          <Empty title="감사의견 원문을 찾지 못했습니다" />
        )}
      </Card>

      {opinion?.basis && (
        <Card title="감사의견근거">
          <Prose text={opinion.basis} muted />
        </Card>
      )}

      {goingConcern?.flagged && (
        <Card title="계속기업 관련 중요한 불확실성" right={<Badge tone="critical" dot>주의</Badge>}>
          <Callout tone="bad">
            감사인이 계속기업으로서의 존속능력에 유의적 의문을 제기했습니다. 자금조달 계획과 차입금 만기를 함께 확인해야 합니다.
          </Callout>
          {goingConcern.text && <div style={{ marginTop: 12 }}><Prose text={goingConcern.text} /></div>}
        </Card>
      )}

      <Card title="핵심감사사항 (KAM)" sub={kam?.items?.length ? `${kam.items.length}개 항목` : '감사인이 가장 유의적이라고 판단한 사항'} tight={Boolean(kam?.items?.length)}>
        {kam?.preamble && (
          <div style={{ padding: kam.items?.length ? '14px clamp(12px, 2vw, 20px) 0' : 0 }}>
            <Prose text={kam.preamble} muted />
          </div>
        )}
        {kam?.items?.length ? (
          kam.items.map((it, i) => (
            <Disclose key={`${it.title}-${i}`} summary={it.title || `핵심감사사항 ${i + 1}`} open={i === 0}>
              <Prose text={it.body} muted empty="본문 없음" />
            </Disclose>
          ))
        ) : kam?.text ? (
          <Prose text={kam.text} muted />
        ) : (
          <Empty title="핵심감사사항이 기재되지 않았습니다">비상장 중소기업 감사보고서에는 기재 의무가 없는 경우가 있습니다.</Empty>
        )}
      </Card>

      {emphasis && (
        <Card title="강조사항" right={<Badge tone="warn">확인 필요</Badge>}>
          <Prose text={emphasis} muted />
        </Card>
      )}

      {internalControl && (
        <Card
          title="내부회계관리제도"
          right={
            <Badge tone={internalControl.effective === true ? 'good' : internalControl.effective === false ? 'critical' : 'muted'} dot>
              {internalControl.effective === true ? '효과적' : internalControl.effective === false ? '미비점 있음' : '판정 불가'}
            </Badge>
          }
        >
          {internalControl.text ? <Prose text={internalControl.text} muted /> : <Empty title="관련 문단을 찾지 못했습니다" />}
        </Card>
      )}

      {other && (
        <Card title="기타사항 · 기타정보">
          <NoteBody content={sectionContent(list, ['other', 'otherInfo'])} body={other} muted />
        </Card>
      )}

      <Card title="감사보고서 전체 절 원문" sub={loading ? '불러오는 중…' : `${list.length}개 절 · 문서에 나온 순서대로`} tight>
        {list.length ? (
          list.map((s, i) => (
            <Disclose key={`${s.key}-${i}`} summary={s.label} count={`${(s.text || '').length.toLocaleString('ko-KR')}자`}>
              <NoteBody content={s.content} body={s.text} muted />
            </Disclose>
          ))
        ) : (
          <div className="card-body"><Empty title={loading ? '불러오는 중…' : '절 구분을 찾지 못했습니다'} /></div>
        )}
      </Card>
    </div>
  )
}
