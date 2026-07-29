# 백엔드 폴더 구조 — 모듈러 레이어드 아키텍처 (Zipboda API)

## 1. 문서 정보

| 항목 | 내용 |
|------|------|
| 문서명 | 백엔드 폴더 구조 — 모듈러 레이어드 아키텍처 |
| 버전 | v1.0.0 |
| 작성일 | 2026-07-27 |
| 기반 문서 | https://docs.nestjs.com (외부 표준) |

### 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v1.0.0 | 2026-07-27 | Claude | 신규 작성 — FE의 frontend-architecture(FSD)에 대응하는 BE 아키텍처 규칙 |

---

## 2. 채택 배경

FE가 FSD로 단방향 의존을 강제하듯, BE는 **도메인 모듈 + 레이어드 구조**로 의존 방향을 강제한다. 백엔드 변경(공공데이터 스키마·PG 등)의 파급을 도메인 모듈 안으로 격리하고, web/app/admin 3개 클라이언트에 안정적 API 계약을 제공한다.

---

## 3. 레이어 계층 — 위→아래로만 의존

| 레이어 | 역할 |
|--------|------|
| `Controller` | HTTP 입출력·DTO 검증·인증/인가 가드. 비즈니스 로직 금지 |
| `Service` | 비즈니스 로직·트랜잭션·유스케이스 조합 |
| `Repository`(Prisma) | DB 접근만. 쿼리 캡슐화 |
| `Mapper` | 엔티티/DB 타입 → 응답 DTO 변환(내부 모델 직접 노출 금지) |

### 의존 규칙
- **Controller → Service → Repository** 단방향. 역방향·건너뛰기 금지.
- 모듈 간 의존은 명시적 import(서비스 주입)로만, 순환 금지(DAG).
- `common/`(하위 계층)은 도메인 모듈을 import하지 않는다.

---

## 4. 폴더 구조 (권장)

```
src/
├── main.ts
├── app.module.ts
├── common/                 전역 공유 (도메인 미참조)
│   ├── filters/            전역 예외 필터(ERR-* 매핑)
│   ├── guards/             JwtAuthGuard, RolesGuard(RBAC)
│   ├── interceptors/       응답 엔벌로프 { success, data, error }
│   ├── pipes/              ValidationPipe
│   ├── decorators/         @Roles 등
│   └── constants/          공통 상수·enum(ITF-*)
├── config/                 env 스키마·설정 로더
├── database/               Prisma schema·client·마이그레이션·시드
├── shared/                 도메인 간 공유 유틸(순수 함수)
└── modules/
    ├── auth/               인증/인가/회원(API-001~008,090/091,100,199)
    ├── subscription/       청약 공고·검색·구독·연계(API-010~012,093~095,110~114)
    ├── application/        청약 신청·자격(API-013~016,115/116)
    ├── score/              가점(API-020~022)
    ├── floorplan/          평면도·2D/3D 자산 서빙(API-030~033,120~122)
    ├── inspiration/        인테리어 영감(API-040~043,130~133)
    ├── showroom/           쇼룸·예약(API-050~052,140~143)
    ├── community/          커뮤니티·신고(API-060~066,180/181)
    ├── notification/       알림·구독 발송(API-093/094,190/191)
    ├── product/ cart/ order/  (2차) 커머스(API-070~082,150~161)
    ├── admin/              대시보드·통계·회원·카테고리(API-101,151~159,170/171,195)
    └── audit/              감사 로그(API-192)
```

각 모듈 내부:
```
modules/subscription/
├── subscription.controller.ts
├── subscription.service.ts
├── subscription.repository.ts
├── dto/                    request/response DTO
├── mappers/                entity → response DTO
├── constants.ts            도메인 상수
└── subscription.module.ts  ★ 모듈 경계(Public API)
```

---

## 5. 공통 관심사(횡단)
- **인증/인가**: `common/guards`(JWT·RBAC)로 일괄. 컨트롤러는 `@Roles`로 선언만.
- **응답 표준**: `common/interceptors`로 엔벌로프 자동 래핑.
- **오류 처리**: `common/filters` 전역 예외 필터가 도메인 예외 → ERR-* 로 변환.
- **검증**: 전역 `ValidationPipe` + DTO. 미검증 값 서비스 진입 금지.

---

## 6. 외부 연계·자산 (경계 격리)
- 공공데이터(LH/SH/GH/IH)는 `subscription` 모듈 내 **기관별 어댑터**로 격리(원천 스키마 → 정규화 DTO). 원천 변경이 도메인 로직에 새지 않게 한다.
- 3D/이미지 자산은 스토리지/CDN 어댑터 뒤로 숨기고 서명 URL만 노출.
- PG(2차)는 결제 어댑터로 격리(멱등·웹훅).

---

## 7. 안티 패턴 (즉시 거절)
| 안티 패턴 | 이유 |
|-----------|------|
| Controller에 비즈니스 로직 | 계층 위반 |
| Service가 다른 도메인 Repository 직접 접근 | 모듈 경계 붕괴 → 대상 모듈 Service 경유 |
| 모듈 간 순환 의존 | DAG 붕괴 |
| Prisma 엔티티를 응답으로 그대로 반환 | 내부 스키마 노출·계약 결합 → Mapper 사용 |
| `common/`이 도메인 모듈 import | 재사용성 파괴 |
| 컨트롤러마다 응답/오류 형식 제각각 | 인터셉터·필터로 표준화 |

---

## 8. 점검 체크리스트 (PR 전)
- [ ] 계층 방향 준수(Controller→Service→Repository)
- [ ] 모듈 간 순환 없음 / 다른 도메인은 Service 경유
- [ ] 응답 엔벌로프·오류코드(ERR-*)·인터페이스(ITF-*) 사용
- [ ] 엔티티 직접 노출 없이 Mapper 경유
- [ ] 외부 연계·자산·PG가 어댑터로 격리
