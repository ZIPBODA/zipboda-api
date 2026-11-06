-- 목록 응답 시간 측정용 합성 데이터: 목록 한 칸(공고 × 단지) :n건, 공고마다 칸 2개, 칸마다 주택형 2개(10%는 면적 구간만).
-- 칸의 5%는 단지 없는 공고 단위 칸, 단지 연결은 이름 70%·주소 20%·관리자 10%, 단지 20%에 평면도 3장.
-- 2026-10-22 앞뒤로 일정이 퍼지고 2%는 일정 없음, 공고 1%는 취소.
-- 테이블을 비우므로 측정용 DB(zipboda_perf)가 아니면 멈춘다. 사용법은 measure-list-latency.mjs 머리말
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF current_database() <> 'zipboda_perf' THEN
    RAISE EXCEPTION '측정용 DB(zipboda_perf)에서만 실행한다 — 지금 DB: %', current_database();
  END IF;
END $$;

TRUNCATE subscriptions, notices, floorplans, complexes CASCADE;

INSERT INTO notices (id, agency_code, title, title_key, supply_category, supply_type, post_date, cancelled_at, origin,
  created_at, updated_at)
SELECT 'perf-n' || lpad(k::text, 6, '0'), 1 + k % 4, t.title, t.title,
  (ARRAY['SALE','PUBLIC_RENTAL','PURCHASE_RENTAL'])[1 + k % 3],
  (ARRAY['행복주택','국민임대','매입임대','공공분양','영구임대'])[1 + k % 5],
  DATE '2026-10-22' - (k % 90),
  CASE WHEN k % 100 = 0 THEN now() END,
  'SYNC', now(), now()
FROM generate_series(1, (:n + 1) / 2) k
CROSS JOIN LATERAL (SELECT (ARRAY['행복주택','국민임대','매입임대','공공분양','영구임대'])[1 + k % 5] || ' ' || k || '차 모집공고' AS title) t;

-- 칸 g는 공고 (g + 1) / 2에 딸린다. 공고 단위 칸(g % 20 = 0)은 단지가 없다
INSERT INTO complexes (id, agency_code, region_code, name, sigungu, address, lat, lng, geocode_status, households,
  area_min, area_max, created_at, updated_at)
SELECT 'perf-c' || lpad(g::text, 6, '0'), 1 + ((g + 1) / 2) % 4, 1 + (g / 4) % 3,
  (ARRAY['강남','송파','마포','수원','부평','고양','성남','노원'])[1 + (g / 5) % 8] || ' ' || g || '단지',
  (ARRAY['강남구','송파구','마포구','장안구','부평구','덕양구','분당구','노원구'])[1 + (g / 5) % 8],
  CASE WHEN g % 10 < 7 THEN NULL
    ELSE (ARRAY['서울특별시','인천광역시','경기도'])[1 + (g / 4) % 3] || ' 어느구 어느로 ' || g END,
  CASE WHEN g % 10 < 7 THEN NULL ELSE 37.3 + random() * 0.5 END,
  CASE WHEN g % 10 < 7 THEN NULL ELSE 126.6 + random() * 0.6 END,
  CASE WHEN g % 10 < 7 THEN 'NO_ADDRESS' ELSE 'OK' END,
  50 + g % 500,
  CASE WHEN g % 7 = 0 THEN 20 + g % 10 END,
  CASE WHEN g % 7 = 0 THEN 30 + g % 10 END,
  now(), now()
FROM generate_series(1, :n) g
WHERE g % 20 <> 0;

INSERT INTO subscriptions (id, notice_id, complex_id, complex_match, region_code, apply_start_date, apply_end_date,
  contract_start_date, supply_units, recruit_count, application_count, created_at, updated_at)
SELECT 'perf-' || lpad(g::text, 6, '0'), 'perf-n' || lpad(((g + 1) / 2)::text, 6, '0'),
  CASE WHEN g % 20 = 0 THEN NULL ELSE 'perf-c' || lpad(g::text, 6, '0') END,
  CASE WHEN g % 20 = 0 THEN NULL WHEN g % 10 < 7 THEN 'NAME' WHEN g % 10 < 9 THEN 'ADDRESS' ELSE 'MANUAL' END,
  1 + (g / 4) % 3,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d - 10 END,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d END,
  CASE WHEN g % 50 = 1 THEN NULL ELSE d + 40 END,
  10 + g % 90,
  10 + g % 90,
  CASE WHEN g % 3 = 0 THEN NULL ELSE (g * 7) % 2000 END,
  now(), now()
FROM (SELECT g, DATE '2026-10-22' + ((g * 37) % 120 - 80) AS d FROM generate_series(1, :n) g) s;

INSERT INTO subscription_units (id, subscription_id, label, size_type, exclusive_area, area_min, area_max,
  supply_households, display_order)
SELECT gen_random_uuid(), 'perf-' || lpad(g::text, 6, '0'),
  CASE WHEN ranged THEN '15~25㎡' ELSE floor(a.area)::text || 'A' END,
  CASE WHEN ranged THEN NULL ELSE floor(a.area)::text END,
  CASE WHEN ranged THEN NULL ELSE a.area END,
  CASE WHEN ranged THEN 15 END,
  CASE WHEN ranged THEN 25 END,
  1 + g % 5, k
FROM generate_series(1, :n) g, generate_series(1, 2) k,
  LATERAL (SELECT round((10 + random() * 50)::numeric, 4) AS area, k = 2 AND g % 10 = 0 AS ranged) a;

INSERT INTO floorplans (id, complex_id, floor, unit_number, unit_type, exclusive_area, has_3d, display_order, created_at,
  updated_at)
SELECT 'perf-c' || lpad(g::text, 6, '0') || '-' || k, 'perf-c' || lpad(g::text, 6, '0'), '2', (100 + k)::text, '전용',
  round((10 + random() * 50)::numeric, 4), k = 1, k, now(), now()
FROM generate_series(1, :n) g, generate_series(1, 3) k
WHERE g % 5 = 1;

ANALYZE notices;
ANALYZE complexes;
ANALYZE subscriptions;
ANALYZE subscription_units;
ANALYZE floorplans;
