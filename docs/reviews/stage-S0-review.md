# 집보다(Zipboda) API S0 스테이지 검토 기록

## 1. 문서 정보

| 항목 | 내용 |
|------|------|
| 문서명 | 집보다(Zipboda) API S0(기반) 스테이지 완료 검토 기록 |
| 버전 | v0.1.0 |
| 작성일 | 2026-10-22 |
| 기반 문서 | /.claude/rules/phase-review.rule.md, /docs/ZIPBODA_development-plan_v0.1.md, /docs/ZIPBODA_erd_v0.1.md, /docs/ZIPBODA_api-contract-delta.md, /.github/workflows/ci.yml |

### 변경 이력

| 버전 | 날짜 | 작성자 | 변경 내용 |
|------|------|--------|-----------|
| v0.1.0 | 2026-10-22 | Claude | 신규 작성 — S0 자동화·회귀 결과, 교차 검토, 수용 기준 대조(ERD 승인·마이그레이션·시드 PASS, GitHub Actions 결과는 확인 대기), 미해결 항목(HIGH 0·MEDIUM 4·LOW 3 — 목록 응답 시간 기준선 반영), 인수인계 |

---

## 2. 검토 대상

| 항목 | 내용 |
|------|------|
| 스테이지 | S0 기반 — 프로젝트·DB·ERD·CI/CD·응답 표준(개발계획서 §4) |
| 산출 PR | #5 `chore/s0-foundation`(기반 + 청약 상세 API-011로 끝까지 검증) |
| 회귀 기준 커밋 | main `7958a8b` — S0 이후 머지된 #6(청약 목록·지도·필터 선택지)·#7(ERD 초안·문서)까지 포함 |
| 판정 | **조건부 완료** — 수용 기준 3개 중 2개 PASS, 'CI 통과'는 로컬에서 같은 단계를 모두 통과했고 GitHub Actions 결과 확인만 남았다(§6) |

---

## 3. 자동화 테스트 결과

CI 워크플로(`.github/workflows/ci.yml`)와 같은 단계를 로컬에서 실행했다(2026-10-22, Node 24, pnpm 10.27, PostgreSQL 17).

| 단계 | 결과 |
|------|------|
| prettier --check | PASS |
| prisma validate · migrate status | PASS — 마이그레이션 3개 모두 적용 |
| typecheck(tsc) | PASS — 오류 0 |
| lint(ESLint + typescript-eslint) | PASS — 오류·경고 0 |
| 단위 테스트(Jest) | PASS — 9개 파일, 47개 |
| e2e(Jest + Supertest, 실제 DB) | PASS — 40개 |
| build(nest build) | PASS |

커버리지(단위 테스트 기준): 핵심 로직 competition·list-rules·schedule·size-type·subscription.service 96~100%. 전체는 78%이며, 빠진 부분은 컨트롤러·리포지토리·모듈 배선으로 e2e가 실제 DB로 검증한다.

---

## 4. 회귀 테스트 결과

S0가 첫 스테이지라 이전 스테이지 테스트는 없다. S0 이후 머지된 S2 일부(#6)를 포함해 전체 테스트를 다시 돌려 모두 통과했다(§3). 추가로 web 정적 데이터 함수와 API 응답을 대조해 목록 2016개 조합, 목록·상세 필드에서 불일치 0건을 확인했다.

---

## 5. 교차 검토 결과

| 항목 | 내용 |
|------|------|
| 방식 | 1인 개발 Self-Review + Claude 코드 검토(정확성·SQL/JS 규칙 일치·입력 경계·문서 정합) |
| 반영한 지적 | 필터 선택지의 메모리 distinct → groupBy, 두 번 읽기 사이 조건 이탈 공고 차단, 정렬 동순위의 결정적 순서, LIKE 와일드카드 이스케이프, NUL 문자·본문 파서 오류의 500 → 422/400, 전용면적 반올림(decimal(9,4)), 상태 규칙 JS·SQL 일치 e2e(변이 lte→lt를 잡는 것 확인) |
| 공유 계약 영향 | 응답 엔벌로프·ERR 코드·ITF 정수 저장은 web·app·admin 공통 계약이다. 정의서와 다른 점은 /docs/ZIPBODA_api-contract-delta.md에 모았고, 정의서는 작업이 모두 끝난 뒤 web 기준으로 한꺼번에 맞춘다(2026-10-22 결정). web 리드와의 합동 검토는 web 연동 착수 시 한다 |

---

## 6. 수용 기준 대조

### 6.1 개발계획서 §6 S0 수용 기준

| 기준 | 결과 | 근거 |
|------|------|------|
| ERD 승인 | **PASS** | 2026-10-22 사용자 승인(ERD v0.1). 이후 v0.2.1까지 승인 반영·전용면적 정밀도·다음 스테이지 목록 정합 |
| 마이그레이션·시드 성공 | **PASS** | 빈 임시 DB에 마이그레이션 3개 적용 성공, 시드 2회 실행 결과 동일(공고 9건·도면 66건 — 여러 번 실행해도 같다). 확인 후 임시 DB 삭제 |
| CI 통과 | **확인 대기** | 로컬에서 CI와 같은 단계 전부 PASS(§3). PR #5·#6·#7의 GitHub Actions 결과를 이 문서에 기록하면 완료 |

### 6.2 S0 산출물(개발계획서 §4)

| 산출물 | 상태 |
|--------|------|
| 프로젝트(NestJS 12·Prisma 7·ESM·TypeScript 6) | 완료 |
| DB(PostgreSQL 17, docker compose 127.0.0.1:5433, 테스트 DB 분리) | 완료 |
| ERD(/docs/ZIPBODA_erd_v0.1.md, 나머지 도메인 초안 /docs/ZIPBODA_erd-draft_v0.1.md) | 완료(S0~S2 범위 확정, S1~S6 초안) |
| CI(GitHub Actions — 검증·타입·린트·단위·빌드·e2e) | 완료 |
| CD(배포) | **미구성** — API 호스팅 미결정(§7 M1) |
| 응답 표준(엔벌로프·ERR-001~016 매핑·검증 오류 E006) | 완료 |

---

## 7. 미해결 항목

HIGH 0건.

| # | 심각도 | 항목 | 오너 | 해결 예정 |
|---|--------|------|------|-----------|
| M1 | MEDIUM | CD(배포) 미구성 — API 호스팅 위치·환경(개발·운영) 결정 필요. web이 API로 전환하려면 먼저 있어야 한다 | 사용자(결정) · BE | S2 web 연동 전 |
| M2 | MEDIUM | GitHub Actions 결과 기록(§6.1 'CI 통과') | 사용자(확인) | 즉시 |
| M3 | MEDIUM | ERD 초안의 S1 결정(D1 관리자 계정, D2 비밀번호 재설정, D3 본인인증, D4 공개 프로필, D14 관리자 회원 검색)과 개인정보처리방침 개정 | 사용자 | S1 착수 전 |
| M4 | MEDIUM | 목록 정렬을 서버에서 한다(ERD §7 미결 5). 합성 공고 1만 건·동시 10에서 필터 없는 목록 P95 540~578ms로 S2 기준(≤500ms) 초과, 3천 건까지는 통과 | BE | S2 완료 전(API-114 연계로 실제 건수가 들어올 때) |
| L1 | LOW | 개발용 시드(web 서울 LH 9개 단지)는 공공데이터 연계 PR에서 제거(backend.rule A1) | BE | S2(API-114) |
| L2 | LOW | API 정의서 갱신 — 계약 차이 문서 기준 일괄 반영 | 사용자 · BE | 전체 작업 완료 후 |
| L3 | LOW | 공공데이터(LH·SH·GH·IH) 오픈API 인증키 미발급 | 사용자 | S2(API-114) 착수 전 |

---

## 8. 인수인계

| 항목 | 내용 |
|------|------|
| 공유 계약 | 응답 `{success, data, error:{code, message}}`, 오류 코드 E001~(ERR-001~016), 코드값은 ITF 정수 그대로. 정의서와 다른 점: /docs/ZIPBODA_api-contract-delta.md |
| 제공 API | API-010 목록, API-011 상세, API-012 지도, 신규 필터 선택지(`/api/subscriptions/filter-options`) |
| 로컬 실행 | `.env.example`을 `.env`로 복사 → `pnpm db:up` → `pnpm db:deploy` → `pnpm db:seed` → `pnpm start:dev`(포트 4000). DB는 127.0.0.1:5433(5432는 다른 프로젝트) |
| 주의 | Prisma 7은 AI가 실행하는 `migrate reset`을 사용자 동의 없이 막는다 — 적용된 마이그레이션은 고치지 말고 새 마이그레이션을 더한다. 프로젝트는 ESM이라 상대 import에 `.js`를 붙인다 |
| 다음 스테이지 | S2 남은 API: 093(알림함 — S1 필요), 110~114(관리자 공고·연계 — S1 필요). 095(통합 검색)는 별도 PR(`feature/search-api`). S2 수용 기준 '목록 P95 ≤ 500ms'는 §7 M4(측정 도구 PR `chore/list-latency-baseline`). S1 인증은 M3 결정 후 착수 |
