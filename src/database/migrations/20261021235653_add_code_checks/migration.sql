-- 코드성 열은 정의서(ITF-001 공급기관 1~4, ITF-004 지역 1~3)에 있는 값만 받는다. Prisma 스키마로는 표현하지 못해 직접 둔다
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_agency_code_check" CHECK ("agency_code" BETWEEN 1 AND 4);
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_region_code_check" CHECK ("region_code" BETWEEN 1 AND 3);
