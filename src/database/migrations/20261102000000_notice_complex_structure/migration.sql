-- ERD v0.3(docs/ZIPBODA_erd_v0.1.md §8): 공고(notices)·단지(complexes)·공고×단지 칸(subscriptions)으로 나눈다.
-- 평면도가 옛 공고 행을 ON DELETE CASCADE로 가리키므로, 옛 공고를 지우기 전에 단지로 옮겨야 평면도가 함께 지워지지 않는다

-- 1) 새 테이블
CREATE TABLE "notices" (
    "id" TEXT NOT NULL,
    "agency_code" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "title_key" TEXT NOT NULL,
    "supply_category" TEXT NOT NULL,
    "supply_type" TEXT,
    "post_date" DATE,
    "apply_url" TEXT,
    "attachments" JSONB,
    "source_status" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "origin" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notice_sources" (
    "source" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "source_params" JSONB,
    "is_primary" BOOLEAN NOT NULL,
    "raw_payload" JSONB,
    "fetched_at" TIMESTAMPTZ(3),

    CONSTRAINT "notice_sources_pkey" PRIMARY KEY ("source","source_key")
);

CREATE TABLE "complexes" (
    "id" TEXT NOT NULL,
    "agency_code" INTEGER NOT NULL,
    "region_code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sigungu" TEXT,
    "address" TEXT,
    "address_key" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geocode_status" TEXT,
    "households" INTEGER,
    "housing_type" TEXT,
    "area_min" DECIMAL(9,4),
    "area_max" DECIMAL(9,4),
    "image_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "complexes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "complex_aliases" (
    "source" TEXT NOT NULL,
    "agency_code" INTEGER NOT NULL,
    "region_code" INTEGER NOT NULL,
    "sigungu" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "complex_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "complex_aliases_pkey" PRIMARY KEY ("source","agency_code","region_code","sigungu","name_key")
);

CREATE TABLE "sync_runs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "fetched_count" INTEGER NOT NULL DEFAULT 0,
    "created_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sync_failures" (
    "id" UUID NOT NULL,
    "sync_run_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "source_key" TEXT,
    "stage" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "payload" JSONB,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_failures_pkey" PRIMARY KEY ("id")
);

-- 2) 옛 공고 행(개발 시드)으로 단지를 만든다. id를 그대로 써서 평면도가 같은 값을 가리키게 한다.
--    옛 supply_type에는 공급 유형이 아니라 주택 유형(도시형생활주택 등)이 들어 있었다. 주소 판별 키는 수집기와 같은 함수로 시드가 채운다
INSERT INTO "complexes" ("id", "agency_code", "region_code", "name", "address", "lat", "lng", "geocode_status",
    "households", "housing_type", "image_url", "created_at", "updated_at")
SELECT "id", "agency_code", "region_code", "title", "address", "lat", "lng",
    CASE WHEN "lat" IS NOT NULL AND "lng" IS NOT NULL THEN 'OK' END,
    "households", "supply_type", "image_url", "created_at" AT TIME ZONE 'UTC', CURRENT_TIMESTAMP
FROM "subscriptions";

-- 3) 평면도를 단지에 붙인다. 옛 FK(CASCADE)는 값을 옮긴 뒤에 지운다
ALTER TABLE "floorplans" ADD COLUMN "complex_id" TEXT;
UPDATE "floorplans" SET "complex_id" = "subscription_id";
ALTER TABLE "floorplans" ALTER COLUMN "complex_id" SET NOT NULL;
ALTER TABLE "floorplans" DROP CONSTRAINT "floorplans_subscription_id_fkey";
DROP INDEX "floorplans_subscription_id_display_order_idx";
ALTER TABLE "floorplans" DROP COLUMN "subscription_id";
CREATE INDEX "floorplans_complex_id_display_order_idx" ON "floorplans"("complex_id", "display_order");
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_complex_id_fkey" FOREIGN KEY ("complex_id") REFERENCES "complexes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) 옛 공고·주택형은 web 화면에 맞춘 가짜 일정이라 옮기지 않고 새 구조로 다시 만든다(ERD §6)
DROP TABLE "subscription_units";
DROP TABLE "subscriptions";

CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "complex_id" TEXT,
    "complex_match" TEXT,
    "region_code" INTEGER NOT NULL,
    "apply_start_date" DATE,
    "apply_end_date" DATE,
    "winner_date" DATE,
    "contract_start_date" DATE,
    "contract_end_date" DATE,
    "move_in_month" TEXT,
    "supply_units" INTEGER,
    "recruit_count" INTEGER,
    "application_count" INTEGER,
    "supply_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_schedules" (
    "id" UUID NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "start_time" TIME(0),
    "end_time" TIME(0),
    "note" TEXT,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "subscription_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_units" (
    "id" UUID NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "label" TEXT,
    "size_type" TEXT,
    "unit_type" TEXT,
    "exclusive_area" DECIMAL(9,4),
    "area_min" DECIMAL(9,4),
    "area_max" DECIMAL(9,4),
    "supply_area" DECIMAL(9,4),
    "unit_number" TEXT,
    "floor_label" TEXT,
    "total_households" INTEGER,
    "supply_households" INTEGER,
    "recruit_count" INTEGER,
    "application_count" INTEGER,
    "deposit_won" BIGINT,
    "monthly_rent_won" BIGINT,
    "sale_price_won" BIGINT,
    "price_note" TEXT,
    "note" TEXT,
    "display_order" INTEGER NOT NULL,

    CONSTRAINT "subscription_units_pkey" PRIMARY KEY ("id")
);

-- 5) 인덱스·FK
CREATE INDEX "notices_agency_code_title_key_post_date_idx" ON "notices"("agency_code", "title_key", "post_date");
CREATE INDEX "notices_post_date_idx" ON "notices"("post_date" DESC);
CREATE INDEX "notice_sources_notice_id_idx" ON "notice_sources"("notice_id");
CREATE INDEX "complexes_region_code_idx" ON "complexes"("region_code");
CREATE INDEX "complexes_lat_lng_idx" ON "complexes"("lat", "lng");
CREATE INDEX "complex_aliases_complex_id_idx" ON "complex_aliases"("complex_id");
CREATE UNIQUE INDEX "subscriptions_notice_id_complex_id_key" ON "subscriptions"("notice_id", "complex_id");
CREATE INDEX "subscriptions_complex_id_idx" ON "subscriptions"("complex_id");
CREATE INDEX "subscriptions_region_code_idx" ON "subscriptions"("region_code");
CREATE INDEX "subscriptions_apply_end_date_idx" ON "subscriptions"("apply_end_date");
CREATE INDEX "subscriptions_apply_start_date_apply_end_date_idx" ON "subscriptions"("apply_start_date", "apply_end_date");
CREATE INDEX "subscription_schedules_subscription_id_sort_order_idx" ON "subscription_schedules"("subscription_id", "sort_order");
CREATE INDEX "subscription_units_subscription_id_display_order_idx" ON "subscription_units"("subscription_id", "display_order");
CREATE INDEX "sync_runs_source_started_at_idx" ON "sync_runs"("source", "started_at" DESC);
CREATE INDEX "sync_failures_sync_run_id_idx" ON "sync_failures"("sync_run_id");

ALTER TABLE "notice_sources" ADD CONSTRAINT "notice_sources_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "complex_aliases" ADD CONSTRAINT "complex_aliases_complex_id_fkey" FOREIGN KEY ("complex_id") REFERENCES "complexes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_complex_id_fkey" FOREIGN KEY ("complex_id") REFERENCES "complexes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_schedules" ADD CONSTRAINT "subscription_schedules_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_units" ADD CONSTRAINT "subscription_units_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_failures" ADD CONSTRAINT "sync_failures_sync_run_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "sync_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6) Prisma 스키마로 쓰지 못하는 제약. 값 목록을 바꾸면 src/modules/subscription/constants.ts도 함께 바꾼다
ALTER TABLE "notices" ADD CONSTRAINT "notices_agency_code_check" CHECK ("agency_code" BETWEEN 1 AND 4);
ALTER TABLE "notices" ADD CONSTRAINT "notices_supply_category_check" CHECK ("supply_category" IN ('SALE', 'PUBLIC_RENTAL', 'PURCHASE_RENTAL'));
ALTER TABLE "notices" ADD CONSTRAINT "notices_origin_check" CHECK ("origin" IN ('SYNC', 'MANUAL'));
ALTER TABLE "notice_sources" ADD CONSTRAINT "notice_sources_source_check" CHECK ("source" IN ('LH', 'APPLYHOME', 'IH', 'SH_RSS', 'GH_FILE'));
ALTER TABLE "complexes" ADD CONSTRAINT "complexes_agency_code_check" CHECK ("agency_code" BETWEEN 1 AND 4);
ALTER TABLE "complexes" ADD CONSTRAINT "complexes_region_code_check" CHECK ("region_code" BETWEEN 1 AND 3);
ALTER TABLE "complexes" ADD CONSTRAINT "complexes_geocode_status_check" CHECK ("geocode_status" IN ('OK', 'NOT_FOUND', 'NO_ADDRESS', 'MANUAL'));
ALTER TABLE "complexes" ADD CONSTRAINT "complexes_area_range_check" CHECK ("area_min" <= "area_max");
ALTER TABLE "complex_aliases" ADD CONSTRAINT "complex_aliases_agency_code_check" CHECK ("agency_code" BETWEEN 1 AND 4);
ALTER TABLE "complex_aliases" ADD CONSTRAINT "complex_aliases_region_code_check" CHECK ("region_code" BETWEEN 1 AND 3);
ALTER TABLE "complex_aliases" ADD CONSTRAINT "complex_aliases_method_check" CHECK ("method" IN ('ADDRESS', 'NAME', 'MANUAL'));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_region_code_check" CHECK ("region_code" BETWEEN 1 AND 3);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_complex_match_check" CHECK ("complex_match" IN ('ADDRESS', 'NAME', 'MANUAL'));
-- 단지를 정한 방법은 단지가 있을 때만 있다
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_complex_match_presence_check" CHECK (("complex_id" IS NULL) = ("complex_match" IS NULL));
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_apply_period_check" CHECK ("apply_start_date" <= "apply_end_date");
ALTER TABLE "subscription_schedules" ADD CONSTRAINT "subscription_schedules_kind_check" CHECK ("kind" IN ('APPLY', 'DOC_TARGET', 'DOC_SUBMIT', 'VIEWING', 'WINNER', 'WINNER_DOC', 'CONTRACT'));
ALTER TABLE "subscription_schedules" ADD CONSTRAINT "subscription_schedules_period_check" CHECK ("start_date" <= "end_date");
ALTER TABLE "subscription_units" ADD CONSTRAINT "subscription_units_area_range_check" CHECK ("area_min" <= "area_max");
ALTER TABLE "subscription_units" ADD CONSTRAINT "subscription_units_amount_check" CHECK ("deposit_won" >= 0 AND "monthly_rent_won" >= 0 AND "sale_price_won" >= 0);
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_trigger_check" CHECK ("trigger" IN ('SCHEDULE', 'MANUAL', 'CLI'));
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_status_check" CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED'));
ALTER TABLE "sync_failures" ADD CONSTRAINT "sync_failures_stage_check" CHECK ("stage" IN ('FETCH', 'NORMALIZE', 'MATCH', 'GEOCODE', 'SAVE'));
ALTER TABLE "sync_failures" ADD CONSTRAINT "sync_failures_level_check" CHECK ("level" IN ('ERROR', 'WARNING'));

-- 값을 정하는 원천은 공고마다 하나
CREATE UNIQUE INDEX "notice_sources_primary_key" ON "notice_sources"("notice_id") WHERE "is_primary";
-- 주소가 같으면 같은 단지(주소가 없는 단지는 별칭으로 찾는다)
CREATE UNIQUE INDEX "complexes_agency_code_address_key_key" ON "complexes"("agency_code", "address_key") WHERE "address_key" IS NOT NULL;
-- 단지 정보가 없는 공고 단위 칸은 공고당 하나
CREATE UNIQUE INDEX "subscriptions_notice_level_key" ON "subscriptions"("notice_id") WHERE "complex_id" IS NULL;
-- 같은 원천을 동시에 두 번 돌리지 않는다
CREATE UNIQUE INDEX "sync_runs_running_key" ON "sync_runs"("source") WHERE "status" = 'RUNNING';
-- 같은 문제가 수집마다 쌓이지 않고 retry_count만 는다
CREATE UNIQUE INDEX "sync_failures_open_key" ON "sync_failures"("source", "source_key", "stage", "error_code") NULLS NOT DISTINCT WHERE "resolved_at" IS NULL;
CREATE INDEX "sync_failures_open_idx" ON "sync_failures"("level", "created_at") WHERE "resolved_at" IS NULL;
