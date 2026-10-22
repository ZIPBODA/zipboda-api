-- 목록 응답 시간 측정용 합성 공고: :n건, 공고마다 도면 3장. 2026-10-22 앞뒤로 일정이 퍼지고 2%는 일정 없음, 1%는 취소.
-- 테이블을 비우므로 측정용 DB(zipboda_perf)가 아니면 멈춘다. 사용법은 measure-list-latency.mjs 머리말
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'zipboda_perf' THEN
    RAISE EXCEPTION '측정용 DB(zipboda_perf)에서만 실행한다 — 지금 DB: %', current_database();
  END IF;
END $$;

TRUNCATE subscriptions CASCADE;

INSERT INTO subscriptions (id, title, agency_code, region_code, address, lat, lng, supply_type, households, supply_units,
  recruit_count, application_count, post_date, apply_start_date, apply_end_date, contract_date, cancelled_at, created_at, updated_at)
SELECT 'perf-' || lpad(g::text, 6, '0'),
  (ARRAY['행복주택','국민임대','매입임대','전세임대','공공분양'])[1 + g % 5] || ' ' ||
    (ARRAY['강남','송파','마포','수원','부평','고양','성남','노원'])[1 + (g / 5) % 8] || ' ' || g || '단지',
  1 + g % 4,
  1 + (g / 4) % 3,
  (ARRAY['서울특별시','인천광역시','경기도'])[1 + (g / 4) % 3] || ' 어느구 어느로 ' || g,
  37.3 + random() * 0.5,
  126.6 + random() * 0.6,
  (ARRAY['행복주택','국민임대','매입임대'])[1 + g % 3],
  50 + g % 500,
  10 + g % 90,
  10 + g % 90,
  CASE WHEN g % 3 = 0 THEN NULL ELSE (g * 7) % 2000 END,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d - 10 END,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d END,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d + 5 END,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d + 40 END,
  CASE WHEN g % 100 = 0 THEN now() END,
  now(), now()
FROM (SELECT g, DATE '2026-10-22' + ((g * 37) % 120 - 80) AS d FROM generate_series(1, :n) g) s;

INSERT INTO floorplans (id, subscription_id, floor, unit_number, unit_type, exclusive_area, has_3d, display_order, created_at, updated_at)
SELECT 'perf-' || lpad(g::text, 6, '0') || '-' || k, 'perf-' || lpad(g::text, 6, '0'), '2', (100 + k)::text, '전용',
  round((10 + random() * 50)::numeric, 4), k = 1, k, now(), now()
FROM generate_series(1, :n) g, generate_series(1, 3) k;

ANALYZE subscriptions;
ANALYZE floorplans;
