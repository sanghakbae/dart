// 감사보고서 본문(서술부)을 표준 절 단위로 쪼개고 감사의견 유형을 판정한다.
// 2018년 이후 신 감사보고서 체계의 표준 표제를 기준으로 한다.

import { buildContent } from './blocks.js'

const HEADINGS = [
  { key: 'opinion', label: '감사의견', re: /^(감사의견|검토의견)\s*$/ },
  { key: 'qualifiedBasis', label: '한정의견의 근거', re: /^한정의견의?\s*근거/ },
  { key: 'adverseBasis', label: '부적정의견의 근거', re: /^부적정의견의?\s*근거/ },
  { key: 'disclaimerBasis', label: '의견거절의 근거', re: /^의견\s*거절의?\s*근거/ },
  { key: 'basis', label: '감사의견근거', re: /^감사의견\s*근거|^감사의견의\s*근거|^검토의견의?\s*근거/ },
  { key: 'goingConcern', label: '계속기업 관련 중요한 불확실성', re: /^계속기업\s*관련\s*(중요한)?\s*불확실성/ },
  { key: 'kam', label: '핵심감사사항', re: /^핵심감사사항/ },
  { key: 'emphasis', label: '강조사항', re: /^강조사항/ },
  { key: 'other', label: '기타사항', re: /^기타사항/ },
  { key: 'otherInfo', label: '기타정보', re: /^기타정보/ },
  { key: 'mgmtResp', label: '재무제표에 대한 경영진과 지배기구의 책임', re: /^재무제표에?\s*대한\s*경영진과?\s*(지배기구|감사)/ },
  { key: 'auditorResp', label: '재무제표감사에 대한 감사인의 책임', re: /^(재무제표\s*감사에?\s*대한\s*)?감사인의\s*책임/ },
  { key: 'auditPartner', label: '업무수행이사', re: /^(감사)?업무수행이사|^업무수행\s*이사/ },
  { key: 'notes', label: '주석', re: /^주\s*석\s*$/ },
]

export function parseNarrative(doc) {
  // 절 본문에도 표(K-IFRS 전환 조정표, 감사참여자 등)와 목차가 들어 있어
  // 셀 구조를 버리면 한 문단으로 뭉개진다. 줄마다 cells 를 함께 들고 다닌다.
  const rows = doc.rows.map((r) => ({
    text: r.text.replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim(),
    cells: (r.cells || []).map((c) => String(c).trim()).filter((c) => c !== ''),
  }))
  const sections = []
  let cur = { key: 'preamble', label: '표지 및 수신', lines: [], startLine: 0 }

  rows.forEach((row, i) => {
    if (!row.text) return
    const head = matchHeading(row.text)
    if (head) {
      if (cur.lines.length) sections.push(cur)
      cur = { key: head.key, label: head.label, lines: [], startLine: i }
      // 표제와 본문이 한 줄에 붙은 경우 잔여 텍스트를 본문으로 살린다.
      const rest = head.rest.trim()
      if (rest) cur.lines.push({ text: rest, cells: [rest] })
      return
    }
    cur.lines.push(row)
  })
  if (cur.lines.length) sections.push(cur)

  const byKey = {}
  for (const s of sections) {
    const text = s.lines.map((l) => l.text).join('\n').trim()
    if (!byKey[s.key]) byKey[s.key] = { key: s.key, label: s.label, text, lines: s.lines, startLine: s.startLine }
    else {
      byKey[s.key].text += `\n${text}`
      byKey[s.key].lines = [...byKey[s.key].lines, ...s.lines]
    }
  }

  const opinionText = byKey.opinion?.text || ''
  const verdict = classifyOpinion(opinionText, doc.fullText)

  return {
    sections: Object.values(byKey).map((s) => ({
      key: s.key,
      label: s.label,
      startLine: s.startLine,
      text: s.text.trim(),
      content: buildContent(s.lines || []),
    })),
    opinion: {
      ...verdict,
      text: trim(opinionText, 6000),
      basis: trim(byKey.basis?.text || byKey.qualifiedBasis?.text || byKey.adverseBasis?.text || byKey.disclaimerBasis?.text || '', 6000),
    },
    goingConcern: {
      flagged: Boolean(byKey.goingConcern) || /계속기업으로서의?\s*존속능력에?\s*(유의적|중대한)?\s*의문/.test(doc.fullText),
      text: trim(byKey.goingConcern?.text || '', 4000),
    },
    kam: {
      ...splitKam(byKey.kam?.text || ''),
      text: trim(byKey.kam?.text || '', 12000),
    },
    emphasis: trim(byKey.emphasis?.text || '', 6000),
    other: trim([byKey.other?.text, byKey.otherInfo?.text].filter(Boolean).join('\n\n'), 6000),
    auditPartner: extractPartner(`${byKey.auditPartner?.text || ''}\n${doc.fullText}`),
    internalControl: /내부회계관리제도\s*감사(의견)?|내부회계관리제도\s*검토/.test(doc.fullText)
      ? extractIcfr(doc.fullText)
      : null,
  }
}

function matchHeading(line) {
  if (line.length > 60) return null
  const clean = line.replace(/^[\d]+[.)]\s*/, '').replace(/[:：]\s*$/, '').trim()

  // 1차: 정규식 매칭. '감사의견근거'가 '감사의견'으로 먼저 잡히지 않도록
  //      표제 접두 매칭(2차)보다 반드시 앞서 돌려야 한다.
  for (const h of HEADINGS) {
    if (h.re.test(clean)) return { ...h, rest: clean.replace(h.re, '') }
  }

  // 2차: "감사의견 우리는 …" 처럼 표제와 본문이 한 줄에 붙은 형태.
  //      표제 뒤가 다시 한글로 이어지면 다른 표제일 수 있으니 제외한다.
  for (const h of HEADINGS) {
    if (!clean.startsWith(h.label)) continue
    const rest = clean.slice(h.label.length)
    if (rest && /^[가-힣]/.test(rest)) continue
    return { ...h, rest }
  }
  return null
}

const VERDICTS = [
  { type: 'disclaimer', label: '의견거절', tone: 'critical', re: /의견을?\s*표명하지\s*아니(하|합)|의견\s*거절/ },
  { type: 'adverse', label: '부적정의견', tone: 'critical', re: /부적정의견|적정하게\s*표시하고\s*있지\s*않/ },
  { type: 'qualified', label: '한정의견', tone: 'warn', re: /한정의견/ },
  {
    type: 'unqualified',
    label: '적정의견',
    tone: 'good',
    re: /(중요성의?\s*관점에서\s*)?공정하게\s*표시하고\s*있(습니다|다)|적정하게\s*표시하고\s*있(습니다|다)|적정의견/,
  },
]

/**
 * 사업보고서의 감사의견 요약 표.
 *
 * 상장사 사업보고서에는 감사보고서 전문이 없다(첨부로 따로 붙는다). 대신
 * 「V. 회계감사인의 감사의견 등」에 표로 실린다.
 *
 *   사업연도  구분          감사인        감사의견
 *   제78기(당기) 감사보고서   삼정회계법인   적정의견
 *                연결감사보고서 삼정회계법인   적정의견
 *   제77기(전기) …
 *
 * 감사의견 절을 못 찾으면 본문 앞 12,000자를 훑었는데, 사업보고서는 그 앞이
 * 통째로 목차라 아무것도 안 걸려 SK하이닉스가 '판정 불가' 로 떴다.
 * 당기 행만 봐야 한다 — 전기까지 훑으면 옛 의견을 물어 온다.
 */
function opinionFromSummary(fullText) {
  // 제목("회계감사인의 감사의견 등")은 목차에도 똑같이 있어 그걸로 찾으면
  // 목차를 잘라 오게 된다. 표의 머리글로 앵커를 잡는다.
  const head = /사업연도\s*구분\s*감사인\s*감사의견/.exec(fullText)
  if (!head) return null
  // 당기 행부터 다음 사업연도 행(제77기…) 전까지.
  const zone = fullText.slice(head.index, head.index + 4000)
  const cur = /제\s*\d+\s*기\s*\(\s*당\s*기\s*\)([\s\S]*?)(?=제\s*\d+\s*기\s*\(\s*전)/.exec(zone)
  return cur ? cur[1] : null
}

function classifyOpinion(opinionText, fullText) {
  const scope = opinionText || opinionFromSummary(fullText) || fullText.slice(0, 12000)
  for (const v of VERDICTS) {
    if (v.re.test(scope)) return { type: v.type, label: v.label, tone: v.tone }
  }
  return { type: 'unknown', label: '판정 불가', tone: 'muted' }
}

/**
 * 핵심감사사항 본문을 소제목 단위로 나눈다.
 * 첫 소제목 이전의 도입 문단은 항목이 아니라 preamble 로 따로 보관한다.
 */
function splitKam(text) {
  if (!text) return { preamble: '', items: [] }
  const lines = text.split('\n')
  const items = []
  const preamble = []
  let cur = null
  for (const line of lines) {
    const isTitle =
      line.length <= 70 &&
      (/^[0-9]+[.)]\s*\S/.test(line) ||
        /^[가-하][.)]\s*\S/.test(line) ||
        /^[-·•▪]\s*\S/.test(line) ||
        /(에 대한 (평가|검토|인식)|의 인식|의 평가|손상|공정가치|수익\s*인식|재고자산|이연법인세|충당부채|영업권)/.test(line))
    if (isTitle && (!cur || cur.body.length)) {
      if (cur) items.push(cur)
      cur = { title: line.replace(/^[0-9가-하][.)]\s*/, '').replace(/^[-·•▪]\s*/, '').trim(), body: [] }
    } else if (cur) {
      cur.body.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (cur) items.push(cur)

  const cleaned = items
    .map((it) => ({ title: it.title, body: it.body.join('\n').trim() }))
    .filter((it) => it.title || it.body)
    .slice(0, 12)

  // 소제목이 하나도 안 잡히면 본문 전체를 한 항목으로 둔다(내용 유실 방지).
  if (!cleaned.length && preamble.length) {
    return { preamble: '', items: [{ title: '핵심감사사항', body: preamble.join('\n').trim() }] }
  }
  return { preamble: preamble.join('\n').trim(), items: cleaned }
}

function extractIcfr(text) {
  const m = /내부회계관리제도[\s\S]{0,600}?(효과적으로\s*설계\s*및\s*운영되고\s*있|중요한\s*취약점|효과적이지\s*않)/.exec(text)
  if (!m) return { effective: null, text: null }
  const effective = /효과적으로\s*설계\s*및\s*운영되고\s*있/.test(m[0])
  return { effective, text: trim(m[0], 1500) }
}

function extractPartner(text) {
  const m = /업무수행이사는?\s*([가-힣]{2,5})\s*(?:입니다|이다|공인회계사)/.exec(text)
  return m ? m[1] : null
}

function trim(s, max) {
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}
