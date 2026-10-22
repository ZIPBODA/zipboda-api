// 청약 조회 API 응답 시간(p50·p95) 측정 — S2 수용 기준 '목록 P95 ≤ 500ms' 확인용.
//   1) 측정용 DB: docker exec zipboda-postgres psql -U zipboda -d postgres -c "CREATE DATABASE zipboda_perf"
//      DATABASE_URL을 zipboda_perf로 바꿔 pnpm db:deploy
//   2) 데이터: docker exec -i zipboda-postgres psql -U zipboda -d zipboda_perf -v n=10000 < test/perf/generate-subscriptions.sql
//   3) 서버: pnpm build 후 PORT=4001 DATABASE_URL=<zipboda_perf> node dist/main.js
//   4) 측정: node test/perf/measure-list-latency.mjs http://localhost:4001/api [동시요청수=10] [요청수=200]
//   끝나면 zipboda_perf를 지운다. 기준선은 docs/ZIPBODA_erd_v0.1.md §7 미결 5
const [base = 'http://localhost:4001/api', concurrencyArg = '10', countArg = '200'] = process.argv.slice(2);
const CONCURRENCY = Number(concurrencyArg);
const COUNT = Number(countArg);
const WARMUP = 20;

const SCENARIOS = [
  ['목록 기본(마감순 1쪽)', '/subscriptions'],
  ['목록 경쟁률순', '/subscriptions?sort=COMPETITION'],
  ['목록 세대수순', '/subscriptions?sort=HOUSEHOLDS'],
  ['목록 접수중', '/subscriptions?status=2'],
  ['목록 지역+기관+면적', '/subscriptions?region=1&agency=1&size=20-25'],
  ['목록 검색어(강남)', `/subscriptions?keyword=${encodeURIComponent('강남')}`],
  ['목록 깊은 쪽(50쪽)', '/subscriptions?page=50'],
  ['목록 100건', '/subscriptions?pageSize=100'],
  ['지도 핀(서울 영역)', '/subscriptions/map?bounds=37.4,126.8,37.7,127.2'],
  ['필터 선택지', '/subscriptions/filter-options'],
];

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

async function timed(url) {
  const start = performance.now();
  const response = await fetch(url);
  const body = await response.json();
  if (!body.success) throw new Error(`${url} → ${JSON.stringify(body.error)}`);
  return { ms: performance.now() - start, body };
}

async function run(path) {
  const url = base + path;
  for (let i = 0; i < WARMUP; i++) await timed(url);
  const samples = [];
  let next = 0;
  const worker = async () => {
    while (next < COUNT) {
      next++;
      samples.push((await timed(url)).ms);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  samples.sort((a, b) => a - b);
  const { body } = await timed(url);
  const size = body.data.totalCount ?? body.data.markers?.length ?? '-';
  return { p50: percentile(samples, 50), p95: percentile(samples, 95), max: samples.at(-1), size };
}

console.log(`동시 ${CONCURRENCY} · 시나리오당 ${COUNT}회(예열 ${WARMUP}회 제외)`);
console.log('시나리오 | 결과 건수 | p50 ms | p95 ms | 최대 ms');
for (const [name, path] of SCENARIOS) {
  const r = await run(path);
  console.log(`${name} | ${r.size} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.max.toFixed(0)}`);
}
