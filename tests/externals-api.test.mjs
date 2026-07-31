// 새로 붙인 세 출처의 순수 부분 검증 — KIPRIS 상표·디자인 파싱, 국세청 상태 판정,
// 조달청 응답 매핑·월 구간 계산. 상류는 부르지 않는다(키가 없고, 네트워크에 의존하면 안 된다).
//
// 특히 중요한 것: 상표·디자인은 응답 필드 이름을 문서로만 확인했다. 태그 이름이 갈려도
// 다른 필드가 살아 있어야 하므로, 후보 목록이 실제로 동작하는지를 여기서 못 박아 둔다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemBlocks, mapItem, upstreamError, SERVICES } from '../server/kipris-handler.mjs'
import { mapStatus, cleanBizNo, formatBizNo } from '../server/nts-handler.mjs'
import { mapAward, rowsOf, monthWindows, upstreamError as g2bError } from '../server/g2b-handler.mjs'

const eq = assert.deepEqual

// ── KIPRIS ──────────────────────────────────────────────────
const PATENT_XML = `<response><body><items>
  <PatentUtilityInfo>
    <Applicant>주식회사 무하유|한국대학교</Applicant>
    <InventionName>문서 표절 검사 방법</InventionName>
    <ApplicationNumber>1020200001234</ApplicationNumber>
    <ApplicationDate>20200115</ApplicationDate>
    <RegistrationNumber>102345670000</RegistrationNumber>
    <RegistrationDate>20220301</RegistrationDate>
    <RegistrationStatus>등록</RegistrationStatus>
    <InternationalpatentclassificationNumber>G06F 16/00|G06F 40/00</InternationalpatentclassificationNumber>
  </PatentUtilityInfo>
  <PatentUtilityInfo>
    <Applicant>다른회사</Applicant>
    <InventionName>남의 특허</InventionName>
    <ApplicationNumber>1020200009999</ApplicationNumber>
    <ApplicationDate>20200220</ApplicationDate>
  </PatentUtilityInfo>
</items></body></response>`

test('항목 블록은 감싼 태그 이름과 무관하게 출원번호 단위로 잡힌다', () => {
  const blocks = itemBlocks(PATENT_XML)
  eq(blocks.length, 2)
})

test('특허 항목 매핑 — 공동출원인은 | 로, IPC 는 classes 로', () => {
  const [first] = itemBlocks(PATENT_XML).map((c) => mapItem(c, SERVICES.patents))
  eq(first.title, '문서 표절 검사 방법')
  eq(first.applicationDate, '2020-01-15')
  eq(first.registrationDate, '2022-03-01')
  eq(first.classes, ['G06F 16/00', 'G06F 40/00'])
  eq(first.applicant, '주식회사 무하유|한국대학교')
})

// 상표는 명칭·분류 태그가 문서마다 다르게 적혀 있다. 어느 표기로 와도 읽혀야 한다.
for (const [titleTag, classTag] of [
  ['Title', 'ClassificationCode'],
  ['TitleNameKorean', 'ASignProductClassification'],
  ['TrademarkName', 'ProductClassification'],
]) {
  test(`상표 항목 매핑 — <${titleTag}> · <${classTag}> 표기도 읽는다`, () => {
    const xml = `<items><TradeMarkInfo>
      <ApplicantName>주식회사 무하유</ApplicantName>
      <${titleTag}>카피킬러</${titleTag}>
      <ApplicationNumber>4020200001234</ApplicationNumber>
      <ApplicationDate>20200301</ApplicationDate>
      <ApplicationStatus>등록</ApplicationStatus>
      <${classTag}>09|42</${classTag}>
    </TradeMarkInfo></items>`
    const [it] = itemBlocks(xml).map((c) => mapItem(c, SERVICES.trademarks))
    eq(it.title, '카피킬러')
    eq(it.classes, ['09', '42'])
    eq(it.applicant, '주식회사 무하유')
    eq(it.status, '등록')
  })
}

test('디자인 항목 매핑 — 물품명(ArticleName)을 명칭으로 쓴다', () => {
  const xml = `<items><DesignInfo>
    <Applicant>주식회사 무하유</Applicant>
    <ArticleName>휴대용 스캐너</ArticleName>
    <ApplicationNumber>3020200001234</ApplicationNumber>
    <ApplicationDate>20201231</ApplicationDate>
    <DesignMainClassification>14-04</DesignMainClassification>
  </DesignInfo></items>`
  const [it] = itemBlocks(xml).map((c) => mapItem(c, SERVICES.designs))
  eq(it.title, '휴대용 스캐너')
  eq(it.classes, ['14-04'])
  eq(it.registrationNumber, null)
})

test('KIPRIS 오류 코드 — 31 은 서비스 신청 안내, 00 은 오류가 아니다', () => {
  eq(upstreamError('<resultCode>00</resultCode>', SERVICES.trademarks), null)
  eq(upstreamError('<x/>', SERVICES.trademarks), null)
  assert.match(upstreamError('<resultCode>31</resultCode>', SERVICES.trademarks), /상표 서비스 사용기간/)
  assert.match(upstreamError('<resultCode>30</resultCode>', SERVICES.designs), /디자인 서비스에 등록되지 않은/)
})

// ── 국세청 ──────────────────────────────────────────────────
test('사업자번호 정규화·표기', () => {
  eq(cleanBizNo('123-45-67890'), '1234567890')
  eq(cleanBizNo('12345'), null)
  eq(formatBizNo('1234567890'), '123-45-67890')
})

test('계속사업자', () => {
  const r = mapStatus({ b_no: '1234567890', b_stt: '계속사업자', b_stt_cd: '01', tax_type: '부가가치세 일반과세자' })
  eq(r.registered, true)
  eq(r.status, '계속사업자')
  eq(r.taxType, '부가가치세 일반과세자')
  eq(r.closedAt, null)
})

test('폐업자는 폐업일까지 읽는다', () => {
  const r = mapStatus({ b_no: '1234567890', b_stt: '폐업자', b_stt_cd: '03', end_dt: '20231130' })
  eq(r.status, '폐업자')
  eq(r.closedAt, '2023-11-30')
})

test('국세청에 없는 번호는 상태로 굳히지 않는다', () => {
  // b_stt 가 비고 tax_type 에 안내 문구가 들어온다. 이걸 '계속사업자' 처럼 보이게 두면 안 된다.
  const r = mapStatus({ b_no: '9999999999', b_stt: '', tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.' })
  eq(r.registered, false)
  eq(r.status, null)
  eq(r.taxType, null)
})

// ── 조달청 ──────────────────────────────────────────────────
test('낙찰 1건 매핑', () => {
  const a = mapAward({
    bidNtceNo: '20260101234',
    bidNtceOrd: '00',
    bidNtceNm: '표절검사 솔루션 구매',
    ntceInsttNm: '조달청',
    dminsttNm: '한국대학교',
    opengDt: '2026-03-14 11:00:00',
    sucsfbidAmt: '123,456,000',
    bidwinnrNm: '주식회사 무하유',
    bidwinnrBizno: '123-45-67890',
  })
  eq(a.openedAt, '2026-03-14')
  eq(a.amount, 123456000)
  eq(a.demandInstitution, '한국대학교')
  eq(a.winnerBizNo, '1234567890')
})

test('items 가 배열일 때도 { item: [] } 일 때도 목록을 꺼낸다', () => {
  eq(rowsOf({ response: { body: { items: [{ a: 1 }] } } }).length, 1)
  eq(rowsOf({ response: { body: { items: { item: [{ a: 1 }, { a: 2 }] } } } }).length, 2)
  eq(rowsOf({ response: { body: { items: { a: 1 } } } }).length, 1)
  eq(rowsOf({}).length, 0)
})

test('조달청 오류 판정 — 00 은 정상, 그 밖은 문구로', () => {
  eq(g2bError({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' } } }, 200), null)
  assert.match(
    g2bError({ response: { header: { resultCode: '30', resultMsg: 'SERVICE KEY IS NOT REGISTERED' } } }, 200),
    /30/
  )
})

test('월 구간은 1개월씩, 최근 달이 먼저', () => {
  const w = monthWindows(3, new Date(Date.UTC(2026, 6, 15)))
  eq(w.length, 3)
  eq(w[0], { from: '202607010000', to: '202607312359' })
  eq(w[1], { from: '202606010000', to: '202606302359' })
  eq(w[2], { from: '202605010000', to: '202605312359' })
})
