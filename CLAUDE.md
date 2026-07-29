# 집보다(Zipboda) API — 프로젝트 가이드

집보다 **백엔드 API**. web/app/admin 3개 클라이언트에 공통 계약(REST/JSON)을 제공. 공공 청약 정보 연계, 평면도/3D 자산 서빙, 가점·구독/알림·영감·쇼룸·커뮤니티·마이, 2차 커머스.

## 스택
- **NestJS(Node.js + TypeScript)** + **PostgreSQL + Prisma**
- 인증: JWT(access/refresh) + **RBAC**(ITF-012). 응답 엔벌로프 `{success, data, error}` + 오류코드 ERR-001~016
- 파일/자산: 오브젝트 스토리지(S3 호환) + CDN + 서명 URL. 결제(2차): 국내 PG(멱등키·웹훅)

## 산출물 단일 진실원
API/요구사항/화면 xlsx 3종은 **zipboda-web/docs에서 대표 관리**. 본 저장소는 개발계획서(md)만 보유. 스펙 참조 시 `../zipboda-web/docs/` 사용. (프론트엔드 코딩 규칙은 본 저장소에 두지 않음)

## 규칙 — 해당 상황에서만 읽어 적용
> 규칙은 **항상 로드하지 않는다.** 아래 "상황"에 해당하는 작업을 할 때 그 규칙 파일을 **먼저 열어(Read) 읽고 준수**한다. 해당 없으면 읽지 않는다.

| 상황(트리거) | 읽을 규칙 파일 |
|---|---|
| 백엔드 코드(TS) 작성·수정 | `.claude/rules/backend.rule.md` · `.claude/rules/code-organization.rule.md` |
| 코드 주석 작성·정리 | `.claude/rules/code-comments.rule.md` |
| 모듈/레이어 구조 결정 | `.claude/rules/backend-architecture.rule.md` |
| 커밋·브랜치·PR 진행 | `.claude/rules/contributing-role.rule.md` |
| 마크다운 문서(.md) 작성·수정 | `.claude/rules/document-template.rule.md` |
| 스테이지/Phase 완료 검토 | `.claude/rules/phase-review.rule.md` |
| 테스트 작성·구현 후 검증 | `.claude/rules/test-guide.rule.md` |
| 지시가 모호/검증 불가할 때 | `.claude/rules/unclear.rule.md` |

## 보안
- 비밀값(DB·PG·토큰)은 `.env`(gitignore)에만. 개인정보(무주택·소득 등)는 암호화·마스킹·접근 감사로그.
