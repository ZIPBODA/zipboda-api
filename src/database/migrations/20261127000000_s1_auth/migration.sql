-- S1 회원·인증(ERD v0.4 §4.12~4.19). CHECK·append-only 트리거·첫 약관 버전은 Prisma 스키마로 쓰지 못해 아래에 직접 둔다
-- AlterTable
-- 평면도 시각은 시간대 없이 UTC로 들어 있었다 — 서버 시간대와 상관없이 UTC로 읽어 바꾼다
ALTER TABLE "floorplans" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3) USING "created_at" AT TIME ZONE 'UTC',
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMPTZ(3) USING "updated_at" AT TIME ZONE 'UTC';

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "password_hash" TEXT,
    "name_enc" BYTEA,
    "phone_enc" BYTEA,
    "phone_hash" TEXT,
    "phone_verified_at" TIMESTAMPTZ(3),
    "nickname" TEXT,
    "bio" TEXT,
    "interests" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "avatar_url" TEXT,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "granted_by" TEXT,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT,
    "linked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" TEXT,
    "created_ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terms_versions" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "effective_at" DATE NOT NULL,
    "content_path" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terms_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_agreements" (
    "id" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "terms_version_id" UUID NOT NULL,
    "agreed" BOOLEAN NOT NULL,
    "channel" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "changes" JSONB,
    "ip" INET,
    "user_agent" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_phone_hash_idx" ON "users"("phone_hash");

-- CreateIndex
CREATE INDEX "user_roles_granted_by_idx" ON "user_roles"("granted_by");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_provider_provider_user_id_key" ON "social_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_user_id_provider_key" ON "social_accounts"("user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_created_at_idx" ON "password_reset_tokens"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "terms_versions_type_version_key" ON "terms_versions"("type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "terms_versions_type_effective_at_key" ON "terms_versions"("type", "effective_at");

-- CreateIndex
CREATE INDEX "user_agreements_user_id_terms_version_id_created_at_idx" ON "user_agreements"("user_id", "terms_version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_agreements_terms_version_id_idx" ON "user_agreements"("terms_version_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_agreements" ADD CONSTRAINT "user_agreements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_agreements" ADD CONSTRAINT "user_agreements_terms_version_id_fkey" FOREIGN KEY ("terms_version_id") REFERENCES "terms_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 코드성 값과 행 단위 규칙(ERD §4.12~4.18)
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));
ALTER TABLE "users" ADD CONSTRAINT "users_password_needs_email_check" CHECK ("password_hash" IS NULL OR "email" IS NOT NULL);
ALTER TABLE "users" ADD CONSTRAINT "users_phone_pair_check" CHECK (("phone_enc" IS NULL) = ("phone_hash" IS NULL));
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_check" CHECK ("role" IN ('CITIZEN', 'OPERATOR', 'ADMIN'));
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_provider_check" CHECK ("provider" IN ('kakao', 'naver', 'google'));
ALTER TABLE "terms_versions" ADD CONSTRAINT "terms_versions_type_check" CHECK ("type" IN ('AGE14', 'TERMS', 'PRIVACY', 'MARKETING'));
ALTER TABLE "user_agreements" ADD CONSTRAINT "user_agreements_channel_check" CHECK ("channel" IN ('EMAIL_SIGNUP', 'KAKAO_SIGNUP'));

-- 동의 이력·감사 로그는 더하기만 한다(ERD §5 규칙 26). 보존 기간이 지난 행은 앱이 아니라 테이블 소유자의 관리 작업이 지운다
CREATE FUNCTION "reject_append_only_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%은(는) 기록을 더하기만 한다 — UPDATE·DELETE를 받지 않는다', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "user_agreements_append_only" BEFORE UPDATE OR DELETE ON "user_agreements" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs" FOR EACH ROW EXECUTE FUNCTION "reject_append_only_change"();

-- 첫 약관 버전 — web 가입 화면의 약관 4종(ERD §2.2 S1-11). 이용약관은 web /terms 페이지의 시행일을 따른다.
-- 개인정보 수집·이용 동의 본문은 아직 없다(/privacy는 처리방침이다 — ERD §7 미결 16)
INSERT INTO "terms_versions" ("id", "type", "version", "required", "effective_at", "content_path") VALUES
  (gen_random_uuid(), 'AGE14', 'v1', true, DATE '2026-11-27', NULL),
  (gen_random_uuid(), 'TERMS', 'v1', true, DATE '2026-09-20', '/terms'),
  (gen_random_uuid(), 'PRIVACY', 'v1', true, DATE '2026-11-27', NULL),
  (gen_random_uuid(), 'MARKETING', 'v1', false, DATE '2026-11-27', NULL);
