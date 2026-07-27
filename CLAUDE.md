# 집보다(Zipboda) API — 프로젝트 가이드

집보다 **백엔드 API**. web/app/admin 3개 클라이언트에 공통 계약(REST/JSON)을 제공. 공공 청약 정보 연계, 평면도/3D 자산 서빙, 가점·구독/알림·영감·쇼룸·커뮤니티·마이, 2차 커머스.

## 스택
- **NestJS(Node.js + TypeScript)** + **PostgreSQL + Prisma**
- 인증: JWT(access/refresh) + **RBAC**(ITF-012). 응답 엔벌로프 `{success, data, error}` + 오류코드 ERR-001~016
- 파일/자산: 오브젝트 스토리지(S3 호환) + CDN + 서명 URL. 결제(2차): 국내 PG(멱등키·웹훅)

## 산출물 단일 진실원
API/요구사항/화면 xlsx 3종은 **zipboda-web/docs에서 대표 관리**. 본 저장소는 개발계획서(md)만 보유. 스펙 참조 시 `../zipboda-web/docs/` 사용. (프론트엔드 코딩 규칙은 본 저장소에 두지 않음)

## 규칙 (반드시 준수)
@.claude/rules/backend-rule.md
@.claude/rules/backend-architecture.md
@.claude/rules/code-organization.md
@.claude/rules/contributing-role.md
@.claude/rules/document-template-rule.md
@.claude/rules/phase-review-rule.md
@.claude/rules/test-guide.md
@.claude/rules/unclear-rule.md

## 보안
- 비밀값(DB·PG·토큰)은 `.env`(gitignore)에만. 개인정보(무주택·소득 등)는 암호화·마스킹·접근 감사로그.
