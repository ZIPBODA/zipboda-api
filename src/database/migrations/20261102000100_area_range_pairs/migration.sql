-- 면적 범위는 하한·상한이 함께 있어야 한다 — 한쪽만 있으면 면적 구간 규칙(ERD §5 규칙 11) 어디에도 걸리지 않아 칸이 필터에서 조용히 빠진다
ALTER TABLE "complexes" ADD CONSTRAINT "complexes_area_pair_check" CHECK (("area_min" IS NULL) = ("area_max" IS NULL));
ALTER TABLE "subscription_units" ADD CONSTRAINT "subscription_units_area_pair_check" CHECK (("area_min" IS NULL) = ("area_max" IS NULL));
