-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agency_code" INTEGER NOT NULL,
    "region_code" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "supply_type" TEXT,
    "households" INTEGER,
    "supply_units" INTEGER,
    "recruit_count" INTEGER,
    "application_count" INTEGER,
    "post_date" DATE,
    "apply_start_date" DATE,
    "apply_end_date" DATE,
    "contract_date" DATE,
    "move_in_month" TEXT,
    "apply_url" TEXT,
    "image_url" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_units" (
    "id" UUID NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "size_type" TEXT NOT NULL,
    "unit_type" TEXT,
    "households" INTEGER,
    "price" TEXT,

    CONSTRAINT "subscription_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "floorplans" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "floor" TEXT,
    "unit_number" TEXT,
    "unit_type" TEXT,
    "exclusive_area" DECIMAL(7,2),
    "size_type" TEXT,
    "image_2d_url" TEXT,
    "has_3d" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "floorplans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "subscriptions_agency_code_idx" ON "subscriptions"("agency_code");

-- CreateIndex
CREATE INDEX "subscriptions_region_code_idx" ON "subscriptions"("region_code");

-- CreateIndex
CREATE INDEX "subscriptions_apply_end_date_idx" ON "subscriptions"("apply_end_date");

-- CreateIndex
CREATE INDEX "subscription_units_subscription_id_idx" ON "subscription_units"("subscription_id");

-- CreateIndex
CREATE INDEX "floorplans_subscription_id_display_order_idx" ON "floorplans"("subscription_id", "display_order");

-- AddForeignKey
ALTER TABLE "subscription_units" ADD CONSTRAINT "subscription_units_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "floorplans" ADD CONSTRAINT "floorplans_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
