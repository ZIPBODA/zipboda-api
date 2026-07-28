# 코드 구조 전략 — 상수·enum·DTO·타입 관리 (Zipboda API)

## 1. 문서 정보

| 항목 | 내용 |
|------|------|
| 문서명 | 코드 구조 전략 — 상수·enum·DTO·타입 관리 (백엔드) |
| 버전 | v1.0.0 |
| 작성일 | 2026-07-27 |
| 기반 문서 | .claude/rules/backend-architecture.md |

### 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v1.0.0 | 2026-07-27 | Claude | 신규 작성 — FE의 code-organization(FSD 상수·타입)에 대응하는 BE 버전 |

---

## 2. 원칙

`backend-architecture.md`의 모듈러 레이어드 구조를 단일 기준으로, 상수·enum·DTO·타입을 **모듈/공통 계층에 귀속**시킨다. 전역 잡동사니 `utils`·`types` 덤프 폴더를 만들지 않는다.

---

## 3. 상수·enum 배치

| 분류 | 위치 | 예시 |
|------|------|------|
| **공통 상수/enum**(2개 이상 모듈·앱 전역) | `common/constants/` | `ROWS_PER_PAGE`, 페이지 기본값 |
| **코드성 값(인터페이스 ITF-*)** | `common/constants/` enum + `@zipboda/shared` 공유 | `AgencyCode`(LH/SH/GH/IH), `ApplicationStatus`, `Role` |
| **도메인 전용 상수** | `modules/<domain>/constants.ts` | `SUBSCRIPTION_SYNC_BATCH_SIZE` |

### 배치 원칙
1. 컨트롤러/서비스 파일 상단 인라인 상수 금지 → 해당 `constants.ts`.
2. 순수 함수(`shared/`)에 상수를 섞지 않는다.
3. 동일 값 2개 이상 모듈 사용 시 `common/constants`로 승격.
4. ITF-* 코드값은 **단일 enum**으로 정의하고 API 정의서(ITF)와 동기화. 문자열 리터럴 산재 금지.

### 네이밍
상수 `UPPER_SNAKE_CASE`, enum 멤버는 계약값과 일치(예: `ApplicationStatus.APPLIED = 'APPLIED'`). 매핑 객체 `_MAP`/`_LABEL`.

---

## 4. DTO 배치·규칙

| 종류 | 위치 | 규칙 |
|------|------|------|
| Request DTO | `modules/<domain>/dto/*.request.ts` | class-validator(또는 zod)로 경계 검증. 필수/선택은 API 정의서와 일치 |
| Response DTO | `modules/<domain>/dto/*.response.ts` | 응답 엔벌로프 `data`에 담기는 형태. 내부 엔티티 직접 노출 금지 |

- **엔티티(Prisma) → Response DTO 변환은 `mappers/`에서** 수행(B9). 컨트롤러/서비스가 엔티티를 그대로 반환하지 않는다.

---

## 5. 타입 배치

| 타입 | 위치 | 비고 |
|------|------|------|
| DB 타입 | Prisma 생성 타입 활용 | 수기 중복 정의 금지 |
| API 계약 타입(Req/Res·오류·인터페이스) | `@zipboda/shared` (web/app과 공유) | 정의서 계약과 1:1 |
| 도메인 내부 타입 | `modules/<domain>/` 내부 | 외부 노출은 DTO/계약 타입으로만 |

- `any`·강제 단언·`@ts-ignore` 금지(불가피 시 `unknown` 후 좁힘). 타입 전용 import 사용.

---

## 6. 오류·응답 코드 배치
- 오류코드(ERR-*) 정의·메시지는 `common/`(예: `common/errors`)에 중앙화, 전역 예외 필터에서 매핑.
- 응답 엔벌로프 래핑은 `common/interceptors`에서 일괄(서비스가 성공 데이터만 반환).

---

## 7. 인라인 금지 원칙
컨트롤러/서비스 파일에 상수·매직 넘버·오류 문자열·enum 리터럴을 인라인 선언 금지. 사유: 중복 방지·계약 동기화·변경 영향 최소화.
