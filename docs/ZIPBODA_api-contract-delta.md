# 집보다(Zipboda) API 계약 차이 기록

## 1. 문서 정보

| 항목 | 내용 |
|------|------|
| 문서명 | 집보다(Zipboda) API 계약 차이 기록 (구현 ↔ API 및 인터페이스 정의서) |
| 버전 | v0.6.0 |
| 작성일 | 2026-10-22 |
| 기반 문서 | ../zipboda-web/docs/ZIPBODA_API 및 인터페이스 정의서_v0.1.xlsx, ../zipboda-web/src/entities/subscription/model/types.ts, ../zipboda-web/src/entities/subscription/config/constants.ts, ../zipboda-web/src/entities/subscription/api/subscriptionMapper.ts, /src/modules/subscription/dto/subscription-filter.request.ts, /src/modules/subscription/dto/subscription-list.response.ts, /src/modules/subscription/dto/subscription-detail.response.ts, /src/modules/subscription/dto/search.request.ts, /src/modules/subscription/dto/search.response.ts, /src/modules/subscription/dto/floorplan-detail.response.ts, /src/modules/auth/dto/auth.request.ts, /src/modules/auth/dto/auth.response.ts, ../zipboda-web/src/features/search/lib/search.ts, ../zipboda-web/src/features/search/lib/createSearchIndex.ts, ../zipboda-web/src/shared/lib/searchQuery.ts, /docs/ZIPBODA_erd_v0.1.md |

### 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v0.1.0 | 2026-10-22 | Claude | 신규 작성 — 청약 조회 API(010·011·012)와 신규 필터 선택지 API의 정의서 대비 차이, ITF-003·ITF-010 변경 필요 사항, 정의서 갱신 체크리스트 |
| v0.1.1 | 2026-10-22 | Claude | 기반 문서의 요청 DTO 경로를 실제 파일명(subscription-filter.request.ts)으로 고침 |
| v0.2.0 | 2026-10-22 | Claude | §4.5 API-095 통합 검색 추가 — q 필수(중복 시 422)·type 미지원·page/pageSize 추가(목록과 같은 페이지 규칙), 응답을 page·pageSize + 종류별 {items, totalCount}로(floorplans 없음, products는 S6 전까지 비어 있음), 주택 검색 필드·순위를 web searchAll 기준으로 기록하고 동순위 id 정렬을 예외로 명시, S6 남은 일(종류를 섞는 순위) 기록. §6 체크리스트에 API-095 항목 추가. 기반 문서에 web 검색(features/search, shared/lib/searchQuery)과 검색 DTO 추가 |
| v0.3.0 | 2026-11-02 | Claude | ERD v0.3(공고·단지·공고×단지 칸) 반영 — §3 목록 대상을 '평면도 있는 공고만'에서 '모든 칸'으로(공고 단위 칸 포함), 응답 단위가 공고×단지 칸임을 명시. §4.1 응답에 `noticeTitle` 추가, `title`은 단지명(공고 단위 칸은 공고명), `address`는 빈 값 없이 주소→'지역 시군구'→지역, `supplyType`은 공급 유형(행복주택 등), `sizes`에 주택형 전용면적 포함·이름으로만 이은 단지의 평면도 제외, `keyword` 찾는 필드에 시군구 추가, `size` 구간 규칙(주택형 구간·단지 면적 범위). §4.2 `noticeTitle`·`contractDate`(계약 시작일)·`units` 모양(size null 허용, label·floor·unitNumber 추가, households는 이번 공급 세대, price는 원 단위 금액을 읽은 한 줄)·순서(전용면적→타입→호수)·`floorplans` 노출 조건. §4.3 핀 대상·이름표. §4.5 찾는 필드·'도면이 있는 공고만' 삭제. §6 체크리스트에 web 매퍼 항목 추가. 기반 문서에 ERD 추가 |
| v0.4.0 | 2026-11-11 | Claude | web 실제 API 연결 준비 — §4.1 마감 임박순을 상태로 먼저 나눔(접수 중 마감 가까운 순 → 접수 예정 접수 빠른 순 → 마감 최근 마감 순 → 취소·일정 없음, 실데이터 3,276칸 중 3,236칸이 마감이라 접수 예정이 마감 사이에 묻히던 문제). §4.2 `units[].exclusiveArea`·`floorplans[].image2dUrl` 추가. §4.3 핀을 목록 한 칸과 같은 모양·같은 정렬로(web 지도 옆 목록이 핀마다 카드를 그리고 '결과 정렬'을 단다 — `sort`를 받는다), `totalCount`(좌표 없는 칸까지 센 건수) 추가, `bounds` 생략 시 영역 조건 없음, 실데이터 핀 1,324개 응답 771KB. §4.5 동순위 순서를 새 마감 임박순으로. §4.6 API-031 평면도 상세 신규(dimensions·rooms 없음, complexName·subscriptionId 고르는 규칙). §6 체크리스트에 API-031 추가. 기반 문서에 평면도 DTO 추가 |
| v0.4.1 | 2026-11-24 | Claude | §4.1 `size` 조건의 단지 면적 범위 사용을 '주택형이 없을 때'에서 '면적을 아는 주택형이 없을 때'로 고침(ERD v0.3.16 §5 규칙 11 ④, 미결 15) |
| v0.5.0 | 2026-11-25 | Claude | 정의서 v0.6(2026-11-25)에 v0.4.1까지 모은 차이를 모두 옮기고 해당 행을 지움(§2 규칙) — §3 공통 → 정의서 머리말·ITF-016(오류 응답 `{code, message}`)·ITF-017(날짜 `YYYY-MM-DD`·입주 `YYYY-MM`)·ITF-002 비고(Asia/Seoul)·API-010 키-값 의미(목록 단위·대상·빈 값·ERR-005 조건). §4.1·4.2·4.3·4.5·4.6 → API-010·011·012·095·031 행(Request·Response·키-값 의미·인터페이스/오류코드 ID·연관 화면). §4.4 → API-017(`GET /api/subscriptions/filter-options`) 신규. §5 → ITF-014 전용면적 구간·ITF-015 청약 정렬 신규(ITF-003은 API-094, ITF-010은 API-040·060·070이 함께 써서 바꾸지 않고 비고만 보완). web과 다른 점(모르는 `size`·`sort` 무시, 저장된 글자의 공백 정리, `q` 중복 시 첫 값, 검색 동순위 카탈로그 순서)은 web이 목록·검색을 API로 받게 되면서(web #52, `toFilterQuery`·`sortOf`가 모르는 값을 걸러 보낸다) 차이가 아니게 되어 지움. 지도 핀 응답 크기 기록은 ERD 미결 6에 있어 지움. §6 체크리스트 완료 표시(web 매퍼는 web #52에서 반영), 남은 일을 §3으로 모음(검색 종류 섞기 S6, web `noticeTitle` 표시, API-031 방별 치수). 기반 문서에 web 매퍼 추가 |
| v0.6.0 | 2026-11-27 | Claude | S1-b(이메일 가입·로그인·토큰·내 정보) 구현 차이를 §3으로 추가 — API-001 입력 정리·검사(이메일 소문자, 휴대폰 숫자만·010/011/016~019, 이름 1~50자, 비밀번호 8~64자·영문·숫자·특수문자, 필수 약관 3종 true)와 201 응답, API-002 `user` 모양·잠금 ERR-012, API-004 본문 없이 로그인 묶음 폐기, API-005 응답에 `refreshToken` 추가(회전)·ERR-006만, API-008 `user`·`roles` 모양, 인증 실패 오류코드(ERR-003·006). 남은 일 §3→§4, 체크리스트 §4→§5. 기반 문서에 인증 DTO 추가. 독립 리뷰 반영 — 잠금이 동시 요청에도 다섯 번까지만 검사, 재사용 30초 유예는 몇 번이든·폐기된 토큰이 있는 묶음은 전부 ERR-006, 형식 오류 ERR-005(로그인·재발급), 재설정 해제는 S1-c, 체크리스트의 남은 일 절 번호 |

---

## 2. 목적

2026-10-22 결정: API 계약은 **web 화면을 기준**으로 구현하고, 정의서(xlsx)는 작업이 모두 끝난 뒤 web 기준으로 한 번에 맞춘다. 이 문서는 그때 정의서에 옮길 차이를 모은다. 정의서를 갱신하면 해당 행을 지우고 변경 이력에 남긴다.

2026-11-25 정의서 v0.6에 v0.4.1까지의 차이를 모두 옮겼다(변경 이력 v0.5.0). 그 뒤 S1 회원·인증을 web 화면과 ERD v0.4(§2.2 결정)를 기준으로 구현하며 생긴 차이를 §3에 모은다.

---

## 3. S1 회원·인증 — 정의서와 다른 점

ERD v0.4 §2.2(사용자 결정·승인한 권장안)와 §5 규칙 20~26을 따른다. 오류코드는 공통 오류코드 정의서 그대로다 — 토큰이 없거나 잘못되면 ERR-003(E004·401), access·refresh가 만료됐거나 쓸 수 없으면 ERR-006(E007·401).

### 3.1 API-001 `POST /api/auth/signup` — 회원가입

| 구분 | 정의서 | 구현 |
|------|--------|------|
| `name` | string(필수) | 앞뒤 공백을 버리고 1~50자. 저장은 암호문(ERD §5 규칙 21) |
| `email` | string(필수) | 앞뒤 공백을 버리고 소문자로 바꿔 저장·비교. 형식이 이메일이 아니거나 254자를 넘으면 ERR-005. 이미 쓰는 이메일은 ERR-004(대소문자만 달라도 같다) |
| `password` | string(필수) | 8~64자, 영문·숫자·특수문자(영문 자판 기호)를 모두 담아야 한다(REQ-GU-007, 64자 상한은 ERD 규칙 20이 더함) |
| `phone` | string(필수) | 하이픈·공백을 빼고 숫자만 — 010·011·016~019로 시작하는 10~11자리. 인증하지 않고 저장한다(ERD §2.2 S1-2, API-007은 아직 없다) |
| `agreements` | `{ age14, terms, privacy, marketing }` | 같은 모양. 필수 3종은 true여야 하고(아니면 ERR-005), 동의는 종류마다 오늘 시행 중인 약관 버전에 남긴다 |
| 응답 | `{ userId, email }` | 같음(HTTP 201). `email`은 소문자로 정리한 값 |

### 3.2 API-002 `POST /api/auth/login` — 이메일 로그인

| 구분 | 정의서 | 구현 |
|------|--------|------|
| 응답 `user` | (object) | `{ id, email, name, nickname, avatarUrl }` — 이름은 복호화한 원문, 값이 없으면 null |
| 실패 | ERR-002·ERR-004·ERR-006 | 없는 이메일·카카오 전용 회원·틀린 비밀번호는 모두 ERR-002(가입 여부를 드러내지 않는다). 이메일 형식이 아니거나 비밀번호가 비었거나 64자를 넘으면 ERR-005. ERR-004·006은 쓰지 않는다 |
| 잠금 | 실패 5회 시 계정 잠금 | 연속 5회 틀리면 30분 잠그고, 그동안은 맞는 비밀번호도 **ERR-012**(E013·429). 동시에 보내도 30분에 다섯 번까지만 검사한다. 30분이 지나거나 비밀번호를 재설정하면(S1-c) 풀린다 |
| 토큰 | accessToken·refreshToken | access는 15분 JWT(회원 id·역할·로그인 묶음 id), refresh는 30일 불투명 토큰 |

### 3.3 API-004 `POST /api/auth/logout` — 로그아웃

| 구분 | 정의서 | 구현 |
|------|--------|------|
| 요청 | `{}`, Bearer | 같음 — 본문 없이 access에 담긴 로그인 묶음의 refresh를 모두 폐기한다. 다른 기기의 로그인은 그대로다. 이미 낸 access는 만료(15분)까지 남는다 |
| 응답 | (object\|null) | `data: null` |

### 3.4 API-005 `POST /api/auth/token/refresh` — 토큰 재발급

| 구분 | 정의서 | 구현 |
|------|--------|------|
| 응답 | `{ accessToken }` | **`{ accessToken, refreshToken }`** — refresh를 쓸 때마다 새로 준다(회전, ERD §2.2 S1-7). web은 받은 새 refresh로 바꿔 둔다 |
| 재사용 | 미정 | 쓴 refresh가 30초 안에 다시 오면 새 토큰을 준다(여러 탭 동시 요청 — 30초 안에는 몇 번이든). 그보다 늦거나, 폐기된 refresh이거나, 폐기된 토큰이 있는 로그인 묶음의 refresh면 그 묶음을 모두 폐기하고 ERR-006 |
| 실패 | ERR-006 | 모르는·만료된·폐기된 refresh는 ERR-006. `refreshToken`이 비었거나 128자를 넘으면 ERR-005 |

### 3.5 API-008 `GET /api/auth/me` — 내 인증 정보

| 구분 | 정의서 | 구현 |
|------|--------|------|
| 응답 | `{ user: (object), roles: (array) }` | `user`는 API-002와 같은 모양, `roles`는 ITF-012 문자열 배열(예 `["CITIZEN"]`) — 토큰이 아니라 DB에서 읽어 역할이 바뀌면 바로 보인다 |
| 실패 | ERR-003 | 토큰이 없거나 잘못되면 ERR-003, 만료면 ERR-006 |

---

## 4. 남은 일

정의서와 구현은 같지만 아직 정하지 않았거나 다음 스테이지로 넘긴 일이다.

| 항목 | 내용 | 시점 |
|------|------|------|
| API-095 종류를 섞는 순위 | web 헤더 추천은 주택·가구를 순위로 섞은 상위 8건이다. 가구가 들어오면 종류를 넘어 섞을 수 있게 항목마다 순위를 줄지 정하고, 검색을 조합하는 쪽을 subscription 모듈 밖으로 뺀다 | S6(커머스) |
| web `noticeTitle` 표시 | API는 목록·상세·지도·검색 항목에 공고명(`noticeTitle`)을 주지만 web 화면은 아직 쓰지 않는다(카드 제목은 단지명 `title`). 어디에 보일지는 화면 변경이라 사용자가 정한다 | 미정 |
| API-031 방별 치수 | `dimensions`·`rooms`는 방별 치수를 저장하지 않아 주지 않는다(정의서 API-031 키-값 의미에 기록) | S4 도면 업로드(API-122) |

---

## 5. 정의서 갱신 체크리스트

v0.4.1까지의 차이를 정의서 v0.6에 옮긴 결과다.

- [x] API-010 Request/Response·키-값 의미 갱신
- [x] API-011 Response 필드 추가
- [x] API-012 bounds 형식·조건·핀 필드 갱신
- [x] 필터 선택지 API 신규 행 추가(API-017)
- [x] API-095 Request(`type` 삭제·`page`·`pageSize` 추가)·Response 모양 갱신
- [x] API-031 Response(`dimensions`·`rooms` 보류, 필드 추가, `subscriptionId` 고르는 규칙) 갱신
- [x] ITF-003·ITF-010 갱신 — 다른 API가 함께 써서 ITF-014(전용면적 구간)·ITF-015(청약 정렬)를 새로 두고, 두 항목에는 비고만 더함
- [x] web 매퍼가 `units[]`의 `exclusiveArea`를 web `SubscriptionUnit.size`(숫자)로, `unitNumber`를 `unit`으로 바꾼다(web #52, `subscriptionMapper`). `noticeTitle`을 보일 곳은 §4 남은 일로 넘김
- [x] 오류 응답 `{code, message}` 규칙을 공통 인터페이스에 명시(ITF-016)
