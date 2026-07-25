# 감사보고서 분석기 (dart.sanghak.kr)

감사보고서를 업로드하면 **감사의견 · 재무제표 · 주석 · 재무비율 · 전년도 대비 추이**를 자동으로 분석해 보여준다.
파싱 결과와 추출 원문 전체를 DB에 저장하므로, 분석 로직이 놓친 내용도 원문 탭에서 그대로 확인할 수 있다.

- 프론트엔드: React 18 + Vite
- 백엔드: Firebase (Firestore) — 미설정 시 브라우저 IndexedDB 로 자동 폴백
- 배포: GitHub Pages (`dart.sanghak.kr`)

## 지원 입력 형식

| 형식 | 비고 |
|---|---|
| PDF | 텍스트 좌표를 y/x 로 묶어 표를 복원한다. 스캔 이미지 PDF(OCR 필요)는 미지원 |
| HTML | DART 뷰어 저장 원문. `rowspan/colspan` 을 펼쳐 표 구조를 그대로 읽는다. EUC-KR 자동 감지 |
| XLSX / XLS / CSV | 재무제표 표. 시트별로 전부 읽는다 |
| TXT | 텍스트로 추출해 둔 보고서 |

여러 파일을 한 번에 올릴 수 있고, **다른 사업연도 보고서를 추가하면 추이 그래프의 연도축이 자동으로 늘어난다.**

## 무엇을 읽어내는가

- **표지**: 회사명, 사업연도/기수, 감사인, 감사보고서일, 업무수행이사, 연결/별도 구분
- **감사의견**: 적정 · 한정 · 부적정 · 의견거절 판정과 의견/근거 원문
- **감사보고서 절 전체**: 핵심감사사항(KAM, 소제목 단위 분리), 강조사항, 계속기업 관련 중요한 불확실성, 기타사항, 경영진·감사인의 책임, 내부회계관리제도
- **재무제표**: 재무상태표 · 손익계산서 · 포괄손익계산서 · 자본변동표 · 현금흐름표
  - 계정과목 사전으로 40여 개 표준 계정을 인식하고, **매칭되지 않은 원문 행도 전부 보존**한다
  - `(단위: 천원)` 등 단위 표기를 감지해 원 단위로 환산 (주당금액은 환산 제외)
  - `(1,234)` `△1,234` 음수 표기, 주석 참조 열 오인 방지
- **주석**: 번호별 항목 분리 + 본문 전체 + 검색
- **재무비율**: 수익성 · 안정성 · 활동성 · 현금흐름 (당기/전기 비교, 연도별 추이)
- **품질 지표**: 계정 인식률, 자산 = 부채 + 자본 대차 검증, 경고 목록

## 그래프

| 차트 | 내용 |
|---|---|
| 손익 추이 | 연도별 매출액 · 영업이익 · 당기순이익 |
| 자산·부채·자본 추이 | 연도별 총계 |
| 재무구조 추이 | 부채 + 자본 누적 막대 (= 자산) |
| 전년 대비 증감률 | 항목별 / 연도별 다이버징 막대 |
| 손익 구조 워터폴 | 매출액 → 매출원가 → … → 당기순이익 |
| 현금흐름 추이 | 영업 · 투자 · 재무활동 |
| 재무비율 추이 | 지표별 소형 라인 차트 (단위가 다른 지표를 한 축에 섞지 않는다) |
| 구성 도넛 | 자산 · 부채 · 자본 구성 |

모든 차트에 **표 보기 토글**이 있어 색만으로 값을 읽지 않아도 되고, 모바일에서도 전체 수치를 확인할 수 있다.
가로폭 100% 반응형이며, 표는 첫 열을 고정한 채 가로 스크롤되므로 모바일에서 데이터가 잘리지 않는다.
라이트/다크 모드 각각에 맞게 검증된 팔레트를 쓴다.

## 로컬 실행

```bash
npm install
npm run dev
```

`.env` 없이도 바로 동작한다(브라우저 IndexedDB 저장). 첫 화면의 **‘예시 파일로 먼저 보기’** 버튼으로
가상 회사 예시 보고서를 즉시 분석해 볼 수 있다.

## Firebase 연결

`.env.example` 을 `.env` 로 복사해 값을 채운다.

```bash
cp .env.example .env
```

| 변수 | 설명 |
|---|---|
| `VITE_FIREBASE_*` | Firebase 콘솔 → 프로젝트 설정 → 내 앱 → SDK 설정 값 |
| `VITE_ALLOWED_EMAILS` | 로그인 허용 이메일 (쉼표 구분). 비우면 모든 Google 계정 허용 |

설정 후 Google 로그인을 하면 Firestore 에 저장된다. 저장 구조:

```
users/{uid}/reports/{reportId}              # 메타 · 감사의견 · 계정 값 · 비율 · 품질
users/{uid}/reports/{reportId}/content/*    # 원문 텍스트 · 표 전체 행 · 주석 본문 · 절 원문 (400KB 청크)
```

원문은 Firestore 문서 1MB 한도를 넘길 수 있어 청크로 나눠 저장하고, 열 때 합쳐서 복원한다.
로컬 사본도 함께 남겨 오프라인에서 바로 열린다.

보안 규칙 배포:

```bash
firebase deploy --only firestore:rules
```

감사보고서는 민감 자료이므로 규칙은 **본인 데이터만 읽고 쓰기**로 잠겨 있다(`firestore.rules`).

## 테스트

```bash
npm test
```

`tests/fixtures/hanbit-2024.txt` (가상 회사 감사보고서)로 금액 정규화, 표지 메타, 감사의견 판정,
표 복원, 단위 환산, 주석 분리, 비율 계산, 다년 추이 병합을 검증한다.

## 배포

`main` 브랜치 push 시 GitHub Actions 가 빌드해 Pages 로 배포한다(`.github/workflows/deploy.yml`).
Firebase 웹 config 는 클라이언트 번들에 실리는 공개 값이므로 저장소 **Variables** 로 주입한다:

Settings → Secrets and variables → Actions → Variables

- `FIREBASE_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_MESSAGING_SENDER_ID`
- `FIREBASE_APP_ID`
- `ALLOWED_EMAILS` (선택, 기본값 `qa@muhayu.com`)

커스텀 도메인은 `public/CNAME` 의 `dart.sanghak.kr` 로 설정된다.
Firebase 콘솔 → Authentication → Settings → 승인된 도메인에 `dart.sanghak.kr` 을 추가해야 로그인이 동작한다.

## 구조

```
src/
  lib/
    extract/     PDF · HTML · 엑셀 → 공통 문서 모델 { rows[{page,cells,text}], fullText }
    parse/       numbers · taxonomy(계정과목 사전) · meta · opinion · statements · notes
    analyze/     ratios(재무비율) · series(연도축 병합) · view(화면용 파생값)
    storage.js   Firestore(청크) / IndexedDB 저장소
  components/
    charts.jsx   차트 + 표 보기 토글
    tabs/        요약 · 감사의견 · 재무제표 · 추이 · 재무비율 · 주석 · 원문
```

## 한계

- 스캔 이미지 PDF 는 텍스트 레이어가 없어 읽지 못한다(OCR 미구현). 업로드 시 명시적으로 알려준다.
- 표 서식이 매우 특이한 문서는 계정 인식률이 떨어질 수 있다. 이 경우에도 원문 행은 모두 보존되어 재무제표 탭의 ‘원문 전체 행’과 원문 탭에서 확인할 수 있다.
- 재무비율의 참고 기준선은 업종 무관 일반값이므로 해석은 사용자 판단이 필요하다.
