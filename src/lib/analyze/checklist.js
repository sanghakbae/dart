// 감사보고서로 회사를 볼 때 확인해야 하는 항목들을 자동 점검한다.
//
// 판정 기준은 업종 무관 일반값이라 '신호'일 뿐 결론이 아니다.
// 각 항목은 근거 수치와 원문 위치(주석 번호)를 함께 돌려주어, 사용자가 직접 확인할 수 있게 한다.

import { growth } from './ratios.js'

const S = { good: 'good', warn: 'warn', bad: 'bad', info: 'info', unknown: 'unknown' }

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pct = (v, d = 1) => (v == null ? '-' : `${v.toLocaleString('ko-KR', { maximumFractionDigits: d })}%`)
const won = (v) => (v == null ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`)

/**
 * @param {object} report 분석된 보고서
 * @param {object} timeline 연도축 (다년 추이)
 * @param {object} notes 주석 (본문 로드된 경우)
 */
export function buildChecklist(report, timeline, notes) {
  const v = report?.values || {}
  const r = report?.ratios?.current || {}
  const rp = report?.ratios?.prior || {}
  const meta = report?.meta || {}
  const rows = timeline?.rows || []
  const noteItems = notes?.items || report?.notes?.items || []
  const noteIndex = notes?.items ? null : report?.notesIndex || null

  const cur = (k) => n(v[k]?.current)
  const pri = (k) => n(v[k]?.prior)

  const items = []
  const add = (o) => items.push(o)

  // 회계정책·작성기준 주석은 모든 주제를 한 번씩 언급하므로 실질 근거가 아니다.
  const POLICY_NOTE = /회계정책|작성기준|제정.*기준서|중요한\s*회계추정/

  /**
   * 주제어에 해당하는 주석을 찾는다.
   * 제목이 걸리는 주석을 우선하고, 없으면 본문에서 찾되 회계정책 주석은 건너뛴다.
   */
  const findNote = (re) => {
    const all = noteItems.length ? noteItems : noteIndex || []
    const byTitle = all.find((item) => re.test(item.title))
    if (byTitle) return { no: byTitle.no, title: byTitle.title, where: 'note' }
    const byBody = noteItems.find((item) => !POLICY_NOTE.test(item.title) && re.test(item.body || ''))
    if (byBody) return { no: byBody.no, title: byBody.title, where: 'note' }
    // 회계정책 주석에만 나오면 실질 기재가 아니라 정책 설명일 뿐이다.
    const inPolicy = noteItems.find((item) => POLICY_NOTE.test(item.title) && re.test(item.body || ''))
    if (inPolicy) return { no: inPolicy.no, title: inPolicy.title, where: 'policy' }
    return null
  }

  // ── 1. 감사의견 · 신뢰성 ────────────────────────────────
  const opinionType = report?.opinion?.type
  add({
    id: 'opinion',
    group: '감사의견 · 신뢰성',
    title: '감사의견 유형',
    status: opinionType === 'unqualified' ? S.good : opinionType === 'qualified' ? S.warn : opinionType === 'unknown' ? S.unknown : S.bad,
    value: report?.opinion?.label || '판정 불가',
    why: '적정의견이 아니면 재무제표 숫자 자체를 그대로 믿기 어렵습니다.',
  })

  add({
    id: 'goingConcern',
    group: '감사의견 · 신뢰성',
    title: '계속기업 불확실성',
    status: report?.goingConcern?.flagged ? S.bad : S.good,
    value: report?.goingConcern?.flagged ? '기재됨' : '기재 없음',
    why: '감사인이 존속능력에 의문을 제기했다면 그 자체가 가장 강한 위험 신호입니다.',
  })

  add({
    id: 'emphasis',
    group: '감사의견 · 신뢰성',
    title: '강조사항',
    status: report?.emphasis ? S.warn : S.good,
    value: report?.emphasis ? '있음' : '없음',
    detail: report?.emphasis ? String(report.emphasis).slice(0, 160) : null,
    why: '의견에는 영향이 없지만 감사인이 굳이 짚은 사항입니다. 소송·지급보증·특수관계자 거래가 자주 나옵니다.',
  })

  const kamCount = report?.kam?.items?.length || 0
  add({
    id: 'kam',
    group: '감사의견 · 신뢰성',
    title: '핵심감사사항(KAM)',
    status: kamCount ? S.info : S.info,
    value: kamCount ? `${kamCount}개` : '기재 없음',
    detail: kamCount ? report.kam.items.map((k) => k.title).join(' · ') : '비상장·소규모 법인은 기재 의무가 없습니다.',
    why: '감사인이 가장 위험하다고 본 회계 영역입니다. 그 항목의 추정·가정을 먼저 의심해야 합니다.',
  })

  add({
    id: 'auditor',
    group: '감사의견 · 신뢰성',
    title: '감사인',
    status: meta.auditor ? S.info : S.unknown,
    value: meta.auditor || '미확인',
    detail: report?.auditPartner ? `업무수행이사 ${report.auditPartner}` : null,
    why: '감사인이 자주 바뀌면 회계 이슈가 있었을 수 있습니다. 직전 보고서와 비교해 보세요.',
  })

  if (report?.internalControl) {
    add({
      id: 'icfr',
      group: '감사의견 · 신뢰성',
      title: '내부회계관리제도',
      status: report.internalControl.effective === true ? S.good : report.internalControl.effective === false ? S.bad : S.unknown,
      value: report.internalControl.effective === true ? '효과적' : report.internalControl.effective === false ? '미비점 있음' : '판정 불가',
      why: '내부통제가 부실하면 재무제표 오류·부정 위험이 올라갑니다.',
    })
  }

  const lag = reportLagDays(meta)
  if (lag != null) {
    add({
      id: 'lag',
      group: '감사의견 · 신뢰성',
      title: '결산일 → 감사보고서일',
      status: lag > 100 ? S.warn : S.good,
      value: `${lag}일`,
      detail: `사업연도 종료 ${meta.fiscalYear}-12-31 → 감사보고서일 ${meta.reportDate}`,
      why: '감사가 길어졌다는 것은 쟁점이 있었다는 신호일 수 있습니다(통상 60~90일).',
    })
  }

  const restatedYears = rows.filter((x) => x.__restated).map((x) => x.label)
  if (restatedYears.length) {
    add({
      id: 'restated',
      group: '감사의견 · 신뢰성',
      title: '과거 수치 재작성',
      status: S.warn,
      value: restatedYears.join(', '),
      why: '회계기준 변경이나 오류수정이 있었다는 뜻입니다. 과거와 단순 비교하면 안 됩니다.',
    })
  }

  // ── 2. 수익성 ───────────────────────────────────────────
  const revG = growth(cur('revenue'), pri('revenue'))
  add({
    id: 'revenueGrowth',
    group: '수익성',
    title: '매출 성장률',
    status: revG == null ? S.unknown : revG >= 0 ? S.good : revG > -10 ? S.warn : S.bad,
    value: pct(revG),
    detail: `${won(pri('revenue'))} → ${won(cur('revenue'))}`,
    why: '역성장은 시장 지위나 수요가 꺾였다는 뜻일 수 있습니다.',
  })

  add({
    id: 'opMargin',
    group: '수익성',
    title: '영업이익률',
    status: r.opMargin == null ? S.unknown : r.opMargin < 0 ? S.bad : r.opMargin < 5 ? S.warn : S.good,
    value: pct(r.opMargin, 2),
    detail: rp.opMargin != null ? `전기 ${pct(rp.opMargin, 2)}` : null,
    why: '본업으로 돈을 버는지 보는 가장 기본 지표입니다.',
  })

  add({
    id: 'netLoss',
    group: '수익성',
    title: '당기순손익',
    status: cur('netIncome') == null ? S.unknown : cur('netIncome') < 0 ? S.bad : S.good,
    value: won(cur('netIncome')),
    detail: `전기 ${won(pri('netIncome'))}`,
    why: '연속 적자는 자본을 깎아 먹어 자본잠식으로 이어집니다.',
  })

  const opv = cur('operatingProfit')
  const niv = cur('netIncome')
  if (opv != null && niv != null && opv !== 0) {
    const gap = Math.abs(niv - opv) / Math.abs(opv)
    add({
      id: 'nonOperating',
      group: '수익성',
      title: '영업이익 대비 순이익 괴리',
      status: gap > 0.5 ? S.warn : S.good,
      value: `${(gap * 100).toFixed(0)}%`,
      detail: `영업이익 ${won(opv)} vs 당기순이익 ${won(niv)}`,
      why: '영업 밖(자산처분·평가이익 등)에서 이익이 나오면 반복되지 않을 수 있습니다.',
    })
  }

  const lossYears = rows.filter((x) => n(x.netIncome) != null && x.netIncome < 0).length
  if (rows.length >= 2) {
    add({
      id: 'lossStreak',
      group: '수익성',
      title: '적자 연도 수',
      status: lossYears === 0 ? S.good : lossYears >= 2 ? S.bad : S.warn,
      value: `${rows.length}개년 중 ${lossYears}개년`,
      why: '연속 적자는 계속기업 위험과 직결됩니다.',
    })
  }

  // ── 3. 안정성 ───────────────────────────────────────────
  add({
    id: 'debtRatio',
    group: '안정성',
    title: '부채비율',
    status: r.debtRatio == null ? S.unknown : r.debtRatio > 400 ? S.bad : r.debtRatio > 200 ? S.warn : S.good,
    value: pct(r.debtRatio),
    detail: rp.debtRatio != null ? `전기 ${pct(rp.debtRatio)}` : null,
    why: '통상 200%를 넘으면 재무 부담이 크다고 봅니다(업종별 차이 큼).',
  })

  add({
    id: 'currentRatio',
    group: '안정성',
    title: '유동비율',
    status: r.currentRatio == null ? S.unknown : r.currentRatio < 100 ? S.bad : r.currentRatio < 150 ? S.warn : S.good,
    value: pct(r.currentRatio),
    why: '100% 미만이면 1년 안에 갚을 돈이 1년 안에 현금화할 자산보다 많다는 뜻입니다.',
  })

  const capital = cur('capitalStock')
  const equity = cur('totalEquity')
  if (capital != null && equity != null) {
    const impaired = equity < capital
    const wiped = equity <= 0
    add({
      id: 'capitalImpairment',
      group: '안정성',
      title: '자본잠식',
      status: wiped ? S.bad : impaired ? S.warn : S.good,
      value: wiped ? '완전자본잠식' : impaired ? `부분잠식 (자본 ${won(equity)} < 자본금 ${won(capital)})` : '해당 없음',
      why: '자본금보다 자본총계가 적으면 잠식입니다. 상장사는 관리종목·상장폐지 사유가 됩니다.',
    })
  }

  add({
    id: 'interestCoverage',
    group: '안정성',
    title: '이자보상배율',
    status: r.interestCoverage == null ? S.unknown : r.interestCoverage < 1 ? S.bad : r.interestCoverage < 3 ? S.warn : S.good,
    value: r.interestCoverage == null ? '-' : `${r.interestCoverage.toFixed(2)}배`,
    why: '1배 미만이면 영업이익으로 이자도 못 냅니다. 3년 연속이면 한계기업으로 분류됩니다.',
  })

  const debt = (cur('shortTermDebt') ?? 0) + (cur('longTermDebt') ?? 0)
  const assets = cur('totalAssets')
  if (debt > 0 && assets) {
    const dep = (debt / assets) * 100
    add({
      id: 'debtDependency',
      group: '안정성',
      title: '차입금 의존도',
      status: dep > 40 ? S.bad : dep > 30 ? S.warn : S.good,
      value: pct(dep),
      detail: `차입금 ${won(debt)} / 자산총계 ${won(assets)}`,
      why: '30%를 넘으면 금리 변동에 취약합니다.',
    })
  }

  // ── 4. 현금흐름 ─────────────────────────────────────────
  const cfo = cur('cfOperating')
  add({
    id: 'cfo',
    group: '현금흐름',
    title: '영업활동 현금흐름',
    status: cfo == null ? S.unknown : cfo < 0 ? S.bad : S.good,
    value: won(cfo),
    detail: `전기 ${won(pri('cfOperating'))}`,
    why: '본업에서 현금이 들어오는지가 이익보다 중요합니다.',
  })

  if (cfo != null && niv != null && niv > 0) {
    const q = cfo / niv
    add({
      id: 'earningsQuality',
      group: '현금흐름',
      title: '이익의 질 (영업현금 ÷ 순이익)',
      status: q < 0.5 ? S.warn : q < 0 ? S.bad : S.good,
      value: `${q.toFixed(2)}배`,
      why: '이익은 나는데 현금이 안 들어오면 매출채권·재고에 잠겨 있거나 이익이 부풀려졌을 수 있습니다.',
    })
  }

  const negCfoYears = rows.filter((x) => n(x.cfOperating) != null && x.cfOperating < 0).length
  if (rows.length >= 2 && negCfoYears) {
    add({
      id: 'cfoStreak',
      group: '현금흐름',
      title: '영업현금 마이너스 연도',
      status: negCfoYears >= 2 ? S.bad : S.warn,
      value: `${rows.length}개년 중 ${negCfoYears}개년`,
      why: '연속 마이너스면 외부 자금 없이는 버티기 어렵습니다.',
    })
  }

  const cfi = cur('cfInvesting')
  if (cfo != null && cfi != null) {
    const fcf = cfo + cfi
    add({
      id: 'fcf',
      group: '현금흐름',
      title: '잉여현금흐름 (영업 + 투자)',
      status: fcf >= 0 ? S.good : S.warn,
      value: won(fcf),
      why: '투자까지 하고도 현금이 남는지 봅니다. 계속 마이너스면 차입·증자에 의존합니다.',
    })
  }

  // ── 5. 자산 건전성 ──────────────────────────────────────
  const arG = growth(cur('tradeReceivables'), pri('tradeReceivables'))
  if (arG != null && revG != null) {
    add({
      id: 'arVsRevenue',
      group: '자산 건전성',
      title: '매출채권 증가율 vs 매출 증가율',
      status: arG > revG + 15 ? S.warn : S.good,
      value: `${pct(arG)} vs ${pct(revG)}`,
      why: '매출채권이 매출보다 훨씬 빨리 늘면 밀어내기·회수 지연을 의심합니다.',
    })
  }

  const invG = growth(cur('inventories'), pri('inventories'))
  if (invG != null && revG != null) {
    add({
      id: 'invVsRevenue',
      group: '자산 건전성',
      title: '재고자산 증가율 vs 매출 증가율',
      status: invG > revG + 20 ? S.warn : S.good,
      value: `${pct(invG)} vs ${pct(revG)}`,
      why: '재고가 매출보다 빨리 늘면 판매 부진·진부화 위험입니다.',
    })
  }

  const intangible = cur('intangibles')
  if (intangible != null && assets) {
    const share = (intangible / assets) * 100
    add({
      id: 'intangibleShare',
      group: '자산 건전성',
      title: '무형자산 비중',
      status: share > 30 ? S.warn : S.good,
      value: pct(share),
      detail: `무형자산 ${won(intangible)} / 자산총계 ${won(assets)}`,
      why: '개발비 자산화가 많으면 비용을 뒤로 미룬 것일 수 있고, 손상 위험이 큽니다.',
    })
  }

  // ── 6. 지배구조 · 우발사항 ─────────────────────────────
  const shares = report?.shares
  if (shares?.majorShareholder) {
    const ratio = shares.majorShareholder.ratio
    add({
      id: 'ownership',
      group: '지배구조 · 우발사항',
      title: '최대주주 지분율',
      status: ratio == null ? S.unknown : ratio >= 50 ? S.info : ratio < 20 ? S.warn : S.info,
      value: `${shares.majorShareholder.name} ${ratio != null ? pct(ratio, 2) : '-'}`,
      why: '지분율이 높으면 의사결정은 빠르지만 견제가 약하고, 너무 낮으면 경영권이 불안정합니다.',
    })
  }

  const topics = [
    { id: 'related', title: '특수관계자 거래', re: /특수관계자/, why: '지배주주·계열사와의 거래는 이익을 옮기는 통로가 될 수 있습니다. 규모와 조건을 봅니다.' },
    { id: 'guarantee', title: '지급보증 · 담보제공', re: /지급보증|담보로\s*제공|담보제공/, why: '재무제표에 부채로 안 잡히지만 현실화되면 바로 부담이 됩니다.' },
    { id: 'contingent', title: '우발부채 · 소송', re: /우발부채|계류|소송/, why: '패소 시 손실이 한 번에 반영됩니다. 청구금액과 진행 상황을 봅니다.' },
    { id: 'covenant', title: '차입 약정 · 재무약정', re: /약정사항|재무비율\s*유지|covenant|한도약정/, why: '약정을 어기면 기한이익 상실로 차입금을 즉시 갚아야 할 수 있습니다.' },
    { id: 'subsequent', title: '보고기간 후 사건', re: /보고기간\s*후\s*사건|후속사건/, why: '결산일 이후 생긴 중요한 변화입니다. 최신 상황을 알 수 있는 유일한 단서입니다.' },
    { id: 'impairment', title: '손상차손', re: /손상차손|손상징후/, why: '자산 가치가 실제보다 부풀려져 있었다는 뜻입니다.' },
    { id: 'stockOption', title: '주식선택권', re: /주식선택권|스톡옵션/, why: '행사되면 지분이 희석됩니다. 1주당 가치 계산에 영향을 줍니다.' },
    { id: 'lease', title: '리스 부채', re: /리스부채|사용권자산/, why: '실질적인 차입입니다. 부채비율을 볼 때 함께 봐야 합니다.' },
  ]
  for (const t of topics) {
    const src = findNote(t.re)
    const isPolicyOnly = src?.where === 'policy'
    add({
      id: t.id,
      group: '지배구조 · 우발사항',
      title: t.title,
      status: !src ? S.good : isPolicyOnly ? S.info : S.warn,
      value: !src ? '언급 없음' : isPolicyOnly ? '회계정책에만 언급' : '주석에 기재됨',
      detail: isPolicyOnly ? '해당 항목을 다루는 별도 주석은 없고, 회계정책 설명에만 나옵니다.' : null,
      source: src,
      why: t.why,
    })
  }

  // ── 7. 상환전환우선주 ──────────────────────────────────
  //
  // 재무비율만 보면 이게 안 보인다. RCPS 는 부채로 잡히는데 부채요소만
  // 재무상태표에 이름이 드러나고, 전환권·조기상환권은 '파생상품부채' 라는
  // 다른 이름으로 앉아 있다. 둘을 합치면 자본총계를 넘기는 일이 흔하다.
  const rcps = report?.rcps
  if (rcps?.found) {
    const equity = cur('totalEquity')
    const burden = rcps.totalLiability
    if (burden != null) {
      const overEquity = equity != null && burden > equity
      add({
        id: 'rcpsBurden',
        group: '상환전환우선주',
        title: 'RCPS 관련 부채 규모',
        status: overEquity ? S.bad : S.warn,
        value: won(burden),
        detail:
          `부채요소 ${won(rcps.liability?.carrying)} + 파생상품부채 ${won(rcps.derivative?.current)}` +
          (equity != null ? ` · 자본총계 ${won(equity)}` : ''),
        why:
          '상환전환우선주는 자본이 아니라 부채입니다. 전환권·조기상환권은 파생상품부채라는 다른 이름으로 따로 잡혀 ' +
          '재무상태표만 훑으면 절반도 안 보입니다. 전환되면 사라지지만, 상환되면 그대로 현금이 나갑니다.',
      })
    }

    if (rcps.putStartDate) {
      const days = Math.round((Date.parse(`${rcps.putStartDate}T00:00:00`) - Date.now()) / 86_400_000)
      const open = Number.isFinite(days) && days <= 0
      const soon = Number.isFinite(days) && days > 0 && days < 365
      add({
        id: 'rcpsPut',
        group: '상환전환우선주',
        title: '상환청구 가능 시점',
        status: open || soon ? S.bad : S.warn,
        value: open ? `${rcps.putStartDate} (이미 열림)` : `${rcps.putStartDate}${soon ? ` · ${days}일 남음` : ''}`,
        detail: rcps.putPeriod || null,
        why:
          '투자자가 상환을 청구하면 원금에 보장수익률을 붙인 금액을 현금으로 내줘야 합니다. ' +
          '재무상태표의 장부금액보다 훨씬 큰 금액이라, 현금성자산과 견줘 봐야 합니다.',
      })
    }

    const rate = rcps.statedRate ?? rcps.impliedRate
    if (rate != null) {
      add({
        id: 'rcpsRate',
        group: '상환전환우선주',
        title: '보장 수익률',
        status: rate >= 8 ? S.bad : rate >= 5 ? S.warn : S.info,
        value: `연복리 ${rate}%`,
        detail:
          rcps.dividend && /0\s*%/.test(rcps.dividend)
            ? `배당은 ${rcps.dividend} 이지만 상환할증금 ${won(rcps.liability?.premium)} 이 수익률을 대신합니다.`
            : rcps.redemption || null,
        why: '배당률이 0% 라도 상환할증금 형태로 수익률이 보장돼 있으면 실질 이자부담은 그대로입니다.',
      })
    }

    if (rcps.accretion?.current != null) {
      const profit = cur('netIncome')
      add({
        id: 'rcpsAccretion',
        group: '상환전환우선주',
        title: '전환권조정 상각 (이자비용)',
        status: profit != null && profit > 0 && rcps.accretion.current > profit ? S.bad : S.warn,
        value: won(rcps.accretion.current),
        detail: profit != null ? `당기순이익 ${won(profit)}` : null,
        why: '현금은 나가지 않지만 당기순이익을 그만큼 깎습니다. 이익이 이 금액보다 작으면 회계상 적자의 원인이 여기 있습니다.',
      })
    }

    if (rcps.refixing) {
      add({
        id: 'rcpsRefixing',
        group: '상환전환우선주',
        title: '전환비율 조정 (리픽싱)',
        status: S.warn,
        value: '조항 있음',
        detail: rcps.refixing,
        why: '주가·공모가가 낮아지면 전환주식수가 늘어 기존 주주의 지분이 더 희석됩니다.',
      })
    }
  }

  const groups = []
  for (const item of items) {
    let g = groups.find((x) => x.name === item.group)
    if (!g) {
      g = { name: item.group, items: [] }
      groups.push(g)
    }
    g.items.push(item)
  }

  const counts = items.reduce(
    (acc, i) => ({ ...acc, [i.status]: (acc[i.status] || 0) + 1 }),
    {}
  )
  return { groups, items, counts, checked: items.length }
}

/** 사업연도 종료일 → 감사보고서일 경과 일수 */
function reportLagDays(meta) {
  if (!meta?.fiscalYear || !meta?.reportDate) return null
  const end = Date.UTC(meta.fiscalYear, 11, 31)
  const [y, m, d] = String(meta.reportDate).split('-').map(Number)
  if (!y || !m || !d) return null
  const report = Date.UTC(y, m - 1, d)
  const days = Math.round((report - end) / 86400000)
  return days > 0 && days < 730 ? days : null
}
