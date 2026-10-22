# 집보다(Zipboda) API 계약 차이 기록

## 1. 문서 정보

| 항목 | 내용 |
|------|------|
| 문서명 | 집보다(Zipboda) API 계약 차이 기록 (구현 ↔ API 및 인터페이스 정의서) |
| 버전 | v0.2.0 |
| 작성일 | 2026-10-22 |
| 기반 문서 | ../zipboda-web/docs/ZIPBODA_API 및 인터페이스 정의서_v0.1.xlsx, ../zipboda-web/src/entities/subscription/model/types.ts, ../zipboda-web/src/entities/subscription/config/constants.ts, /src/modules/subscription/dto/subscription-filter.request.ts, /src/modules/subscription/dto/subscription-list.response.ts, /src/modules/subscription/dto/subscription-detail.response.ts, /src/modules/subscription/dto/search.request.ts, /src/modules/subscription/dto/search.response.ts, ../zipboda-web/src/features/search/lib/search.ts, ../zipboda-web/src/features/search/lib/createSearchIndex.ts, ../zipboda-web/src/shared/lib/searchQuery.ts |

### 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v0.1.0 | 2026-10-22 | Claude | 신규 작성 — 청약 조회 API(010·011·012)와 신규 필터 선택지 API의 정의서 대비 차이, ITF-003·ITF-010 변경 필요 사항, 정의서 갱신 체크리스트 |
| v0.1.1 | 2026-10-22 | Claude | 기반 문서의 요청 DTO 경로를 실제 파일명(subscription-filter.request.ts)으로 고침 |
| v0.2.0 | 2026-10-22 | Claude | §4.5 API-095 통합 검색 추가 — q 필수(중복 시 422)·type 미지원·page/pageSize 추가(목록과 같은 페이지 규칙), 응답을 page·pageSize + 종류별 {items, totalCount}로(floorplans 없음, products는 S6 전까지 비어 있음), 주택 검색 필드·순위를 web searchAll 기준으로 기록하고 동순위 id 정렬을 예외로 명시, S6 남은 일(종류를 섞는 순위) 기록. §6 체크리스트에 API-095 항목 추가. 기반 문서에 web 검색(features/search, shared/lib/searchQuery)과 검색 DTO 추가 |

---

## 2. 목적

2026-10-22 결정: API 계약은 **web 화면을 기준**으로 구현하고, 정의서(xlsx)는 작업이 모두 끝난 뒤 web 기준으로 한 번에 맞춘다. 이 문서는 그때 정의서에 옮길 차이를 모은다. 정의서를 갱신하면 해당 행을 지우고 변경 이력에 남긴다.

---

## 3. 공통

| 항목 | 정의서 | 구현 |
|------|--------|------|
| 오류 응답 | `error: (object\|null)` | `error: { code, message }` — code는 오류코드 정의서의 '반환 코드'(E001…), message는 '반환 메시지'(BAD_REQUEST…) |
| 날짜 형식 | 미정 | 날짜 `YYYY-MM-DD`, 입주 시기 `YYYY-MM`. 값이 없으면 `null` |
| 목록 대상 | 미정 | 평면도가 한 장 이상 있는 공고만 목록·지도에 올린다(상세는 열린다) |
| 상태·D-day 기준 | 미정 | 한국 날짜(Asia/Seoul)로 계산. D-day는 접수 중일 때만 있다 |
| 빈 조건 값 | 미정 | `?region=`처럼 비어 있으면 조건을 걸지 않는다(정렬·페이지는 기본값) |
| 정의 밖 조건 값 | 미정 | 422(ERR-005). 목록·지도에 정의되지 않은 조건 키, 정수가 아닌 코드(공백·`0x3`·소수), 목록에 없는 구간·정렬, 상한(페이지 10,000·페이지 크기 100)을 넘는 값, NUL 문자를 막는다. **web과 다른 점:** web은 예전 링크(`?size=39`)가 빈 목록이 되지 않게 모르는 `size`·`sort`를 무시한다 — web을 API로 옮길 때 주소 값을 API 값으로 바꾸는 쪽에서 걸러 보낸다 |

---

## 4. API별 차이

### 4.1 API-010 `GET /api/subscriptions` — 목록·검색·필터

| 구분 | 정의서 | 구현(web 기준) |
|------|--------|----------------|
| `region` | int(ITF-004) | 같음. 0은 전체 |
| `agency` | int(ITF-001) | 같음. 0은 전체 |
| `size` | string(ITF-003 주택형 39·59·84·114) | **전용면적 구간** `0-15`·`15-20`·`20-25`·`25-30`·`30-` (min ≤ 면적 < max). 매입임대 면적이 소수점이라 주택형 일치로는 못 거른다 |
| `status` | 없음 | **추가** int(ITF-002). 0은 전체 |
| `sort` | ITF-010 POPULAR·LATEST·DEADLINE | **DEADLINE**(D-day 작은 순, D-day 없는 공고 뒤)·**COMPETITION**(경쟁률 낮은 순, 모르면 뒤)·**HOUSEHOLDS**(세대 수 많은 순, 모르면 뒤). 값이 같으면 id 순. 기본 DEADLINE |
| `keyword` | string | 같은 이름. 공고명·주소·공급 유형·기관 약칭(LH 등)·지역 이름에서 대소문자 없이 포함 검색. 검색어의 앞뒤·연속 공백 정리, `%`·`_`·`\`는 글자로 찾는다. 최대 100자. web은 저장된 글자 쪽 공백도 정리하지만 API는 검색어만 정리한다 — 제목의 연속 공백은 적재할 때 정리한다 |
| `page` | int | 같음(1부터) |
| `pageSize` | 없음 | **추가** 기본 20, 최대 100 |
| 응답 항목 | id·title·agencyCode·region·sizes·dday·deadline·households·competition·moveIn, 키-값 의미에 statusCode | **추가** address·lat·lng·supplyType·applicationCount·imageUrl. `sizes`는 전용면적(㎡) 숫자 배열(오름차순·중복 없음) |
| 응답 페이지 | page·totalCount | **추가** pageSize |

### 4.2 API-011 `GET /api/subscriptions/{id}` — 상세

| 구분 | 정의서 | 구현(web 기준) |
|------|--------|----------------|
| 응답 추가 | — | `dday`·`contractDate`·`supplyUnits`(공급 호수)·`recruitCount`(모집 인원)·`applicationCount`(신청 인원)·`imageUrl`(대표 사진) |
| `units` 순서 | 미정 | 주택형 숫자 크기순 → 타입 순 |
| `floorplans` 추가 | id·size·type·has2d·has3d | **추가** `floor`(층 범위)·`unitNumber`(호)·`exclusiveArea`(전용면적 ㎡). 첫째가 상세가 처음 보여 줄 도면 |

### 4.3 API-012 `GET /api/subscriptions/map` — 지도

| 구분 | 정의서 | 구현(web 기준) |
|------|--------|----------------|
| `bounds` | bbox(형식 미정) | `남,서,북,동`(위도·경도, 예 `37.4,126.8,37.7,127.2`). 남>북·서>동이면 ERR-005 |
| 조건 | `agency` | **추가** `region`·`status`·`size`·`keyword` — 목록과 같은 거르기 조건. 정렬·페이지(`sort`·`page`·`pageSize`)는 받지 않는다(422) |
| `bounds` 검사 | 미정 | 위도 −90~90·경도 −180~180, 남≤북·서≤동. 어긋나면 422 |
| 응답 핀 | id·lat·lng·dday·agencyCode | **추가** `title`(핀 이름표)·`statusCode` |
| 대상 | 미정 | 평면도와 좌표가 모두 있는 공고 |

### 4.4 신규 `GET /api/subscriptions/filter-options` — 필터 선택지

| 구분 | 내용 |
|------|------|
| 정의서 | 없음 — **신규 등록 필요** |
| 응답 | `{ regions: int[], agencies: int[], statuses: int[], sizeRanges: [{ value, min, max }] }` |
| 의미 | 걸린 조건과 상관없이 목록 전체에 실제로 있는 값만 준다(눌러도 늘 0건인 선택지를 없앤다). 표시 문구는 web이 정한다 |
| 권한 | 비회원·사용자·운영자·관리자 모두 |

### 4.5 API-095 `GET /api/search` — 통합 검색

| 구분 | 정의서 | 구현(web 기준) |
|------|--------|----------------|
| `q` | string | 필수. 앞뒤 공백을 버린 뒤 비어 있거나 100자를 넘으면 ERR-005. 정규화(연속 공백 하나로·대소문자 무시)는 목록 `keyword`와 같다. 두 번 보내면(`?q=a&q=b`) ERR-005 — web은 첫 값을 쓴다 |
| `type` | string(결과 종류) | **받지 않는다**(422) — web은 종류를 거르지 않고 주택·가구를 한 번에 보여 준다 |
| `page`·`pageSize` | 없음 | **추가** 목록(API-010)과 같다 — page 1부터, pageSize 기본 20·최대 100. 종류마다 같은 페이지로 자른다. web 헤더 추천은 pageSize=8, 결과 화면은 맞은 공고를 모두 보여 주므로 totalCount까지 페이지를 이어 받는다 |
| 응답 | `{ subscriptions:[], floorplans:[], products:[] }` | `{ page, pageSize, subscriptions: { items, totalCount }, products: { items, totalCount } }` — 결과 화면이 종류별 건수를 보여 줘 배열 대신 건수를 함께 준다. **floorplans 없음**(web은 평면도를 따로 찾지 않고 공고로 들어간다). products는 커머스(S6) 전이라 늘 비어 있다 |
| 주택 찾는 필드 | 미정 | 목록 `keyword`와 같다 — 공고명·주소·공급 유형·기관 약칭·지역 이름. 도면이 있는 공고만. web은 저장된 글자의 연속 공백도 정리하지만 API는 검색어만 정리한다(§4.1과 같음) |
| 주택 순위 | 미정 | web `searchAll`과 같다 — 공고명이 검색어와 같음 → 검색어로 시작 → 포함 → 다른 필드만 맞음, 같은 순위는 마감 임박순. **예외**: 그다음 동순위를 web은 카탈로그 순서로, API는 id 순으로 둔다(페이지 경계가 매번 같도록) |
| 주택 항목 | 미정 | 목록(API-010) 항목과 같은 모양 |
| 남은 일(S6) | — | web 헤더 추천은 주택·가구를 순위로 섞은 상위 8건이다. 가구가 들어오면 종류를 넘어 섞을 수 있게 항목마다 순위를 줄지 정하고, 검색을 조합하는 쪽을 subscription 모듈 밖으로 뺀다 |

---

## 5. 공통 인터페이스 변경 필요

| ID | 정의서 | 바꿀 내용 |
|----|--------|-----------|
| ITF-003 | 주택형 39·59·84·114 | 목록 필터는 전용면적 구간을 쓴다 — '전용면적 구간'(0-15·15-20·20-25·25-30·30-)을 새 인터페이스로 두거나 ITF-003을 재정의 |
| ITF-010 | POPULAR·LATEST·DEADLINE | DEADLINE·COMPETITION·HOUSEHOLDS로 교체 |

---

## 6. 정의서 갱신 체크리스트

- [ ] API-010 Request/Response·키-값 의미 갱신(§4.1)
- [ ] API-011 Response 필드 추가(§4.2)
- [ ] API-012 bounds 형식·조건·핀 필드 갱신(§4.3)
- [ ] 필터 선택지 API 신규 행 추가(§4.4)
- [ ] API-095 Request(`type` 삭제·`page`·`pageSize` 추가)·Response 모양 갱신(§4.5)
- [ ] ITF-003·ITF-010 갱신(§5)
- [ ] 오류 응답 `{code, message}` 규칙을 공통 인터페이스에 명시(§3)
