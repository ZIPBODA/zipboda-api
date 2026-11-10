import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client.js';
import { GeocodeError, type Geocoder, type GeoPoint } from '../src/modules/subscription/sync/geocode/kakao-geocoder.js';
import { LhApiError, type LhListQuery } from '../src/modules/subscription/sync/lh/lh-api.client.js';
import { lhBundleOf, type LhNoticeBundle, type LhRow } from '../src/modules/subscription/sync/lh/lh-raw.js';
import { LhSyncRunner, type LhSource } from '../src/modules/subscription/sync/lh/lh-sync-runner.js';
import { LH_PAGE_SIZE } from '../src/modules/subscription/sync/lh/lh.constants.js';
import type { NormalizedNotice } from '../src/modules/subscription/sync/normalized-notice.js';
import { NoticeWriter, type WriteResult } from '../src/modules/subscription/sync/notice-writer.js';
import { SyncAlreadyRunningError, SyncRunRecorder } from '../src/modules/subscription/sync/sync-run-recorder.js';

const NOW = new Date('2026-11-10T00:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const hoursAfter = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);

/** 지금 조회하는 지역(3) × 상위 유형(4) */
const LIST_COMBINATIONS = 12;
const SLOW_FETCH_MS = 50;

const PERMANENT_KEY = '03:2015122300019045';
const NATIONAL_KEY = '03:2015122300018941';
const SALE_KEY = '02:0000061198';

/** LH 실제 응답(test/fixtures/lh)을 원문 일부만 바꿔 읽는다 */
const fixture = (name: string, edits: [string, string][] = []): LhNoticeBundle => {
  const text = edits.reduce(
    (current, [from, to]) => {
      if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
      return current.replaceAll(from, to);
    },
    readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'lh', `${name}.json`), 'utf8'),
  );
  return lhBundleOf(JSON.parse(text));
};

const withRow = (bundle: LhNoticeBundle, edits: Record<string, string>): LhNoticeBundle => ({
  ...bundle,
  notice: { ...bundle.notice, ...edits },
});

const keyOf = (row: LhRow): string => `${row.CCR_CNNT_SYS_DS_CD}:${row.PAN_ID}`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** LH API 대신 저장해 둔 실제 응답을 돌려준다. 목록은 쪽 크기(LH_PAGE_SIZE)로 나눠 준다 */
class FakeLh implements LhSource {
  readonly failingLists = new Set<string>();
  readonly failingPages = new Set<string>();
  readonly failingNotices = new Set<string>();
  readonly unexpectedErrors = new Map<string, Error>();
  readonly slowNotices = new Set<string>();
  readonly fetched: string[] = [];
  listsDown = false;
  beforeFetch: () => Promise<void> | void = () => undefined;
  private readonly lists = new Map<string, LhRow[]>();
  private readonly bundles = new Map<string, LhNoticeBundle>();

  list(region: string, upperType: string, ...bundles: LhNoticeBundle[]): this {
    const listKey = `${region}:${upperType}`;
    for (const bundle of bundles) this.bundles.set(keyOf(bundle.notice), bundle);
    this.lists.set(listKey, [...(this.lists.get(listKey) ?? []), ...bundles.map((bundle) => bundle.notice)]);
    return this;
  }

  listNotices({ region, upperType, page }: LhListQuery): Promise<LhRow[]> {
    const listKey = `${region}:${upperType}`;
    if (this.listsDown || this.failingLists.has(listKey) || this.failingPages.has(`${listKey}:${page}`)) {
      return Promise.reject(new LhApiError('HTTP_500', 'LH 목록 API가 500으로 응답했다'));
    }
    const rows = this.lists.get(listKey) ?? [];
    return Promise.resolve(rows.slice((page - 1) * LH_PAGE_SIZE, page * LH_PAGE_SIZE));
  }

  async bundleOf(notice: LhRow, queryRegion: string): Promise<LhNoticeBundle> {
    const key = keyOf(notice);
    this.fetched.push(`${key}@${queryRegion}`);
    await this.beforeFetch();
    const unexpected = this.unexpectedErrors.get(key);
    if (unexpected !== undefined) throw unexpected;
    if (this.slowNotices.has(key)) await delay(SLOW_FETCH_MS);
    if (this.failingNotices.has(key)) throw new LhApiError('NETWORK', 'LH 상세 API에 닿지 못했다(TypeError)');
    const bundle = this.bundles.get(key);
    if (bundle === undefined) throw new Error(`테스트 목록에 없는 공고 ${key}`);
    return { ...bundle, queryRegion, notice };
  }
}

/** 저장이 정해진 횟수만큼 실패한다(교착 등) */
class FlakyWriter extends NoticeWriter {
  constructor(
    prisma: PrismaClient,
    private readonly failuresLeft: Map<string, number>,
  ) {
    super(prisma);
  }

  override write(notice: NormalizedNotice, raw: unknown, fetchedAt: Date): Promise<WriteResult> {
    const left = this.failuresLeft.get(notice.sourceKey) ?? 0;
    if (left > 0) {
      this.failuresLeft.set(notice.sourceKey, left - 1);
      return Promise.reject(new Error('deadlock detected'));
    }
    return super.write(notice, raw, fetchedAt);
  }
}

class FakeGeocoder implements Geocoder {
  readonly queries: string[] = [];

  constructor(private readonly answer: (address: string) => GeoPoint | null) {}

  geocode(address: string): Promise<GeoPoint | null> {
    this.queries.push(address);
    try {
      return Promise.resolve(this.answer(address));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

const failingGeocoder = (code: string) =>
  new FakeGeocoder(() => {
    throw new GeocodeError(code);
  });

describe('LH 수집 실행 (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  interface RunnerOptions {
    now?: Date;
    clock?: () => Date;
    geocoder?: Geocoder | null;
    writer?: NoticeWriter;
    logs?: string[];
  }

  const runnerOf = (
    lh: LhSource,
    { now = NOW, clock = () => now, geocoder = null, writer, logs }: RunnerOptions = {},
  ) =>
    new LhSyncRunner({
      prisma,
      lh,
      writer: writer ?? new NoticeWriter(prisma),
      recorder: new SyncRunRecorder(prisma, clock),
      geocoder,
      now: clock,
      log: (message) => logs?.push(message),
    });
  const run = (runner: LhSyncRunner, full = false) =>
    runner.run({ trigger: 'CLI', from: '20251101', to: '20261110', full });

  const openFailures = () =>
    prisma.syncFailure.findMany({ where: { resolvedAt: null }, orderBy: [{ sourceKey: 'asc' }, { stage: 'asc' }] });
  const openErrorCount = () => prisma.syncFailure.count({ where: { resolvedAt: null, level: 'ERROR' } });

  const clean = async () => {
    await prisma.syncRun.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.notice.deleteMany();
    await prisma.floorplan.deleteMany();
    await prisma.complex.deleteMany();
  };

  beforeEach(clean);
  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it('같은 공고가 여러 조회 지역에 나와도 처음 지역(서울)으로 한 번만 받고, 실행 이력을 남긴다', async () => {
    const permanent = fixture('permanent-multi-complex');
    const lh = new FakeLh().list('41', '06', permanent).list('11', '06', permanent);

    const summary = await run(runnerOf(lh));

    expect(lh.fetched).toEqual([`${PERMANENT_KEY}@11`]);
    expect(summary).toMatchObject({ status: 'SUCCEEDED', listed: 1, fetched: 1, created: 1, failed: 0, deferred: 0 });
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).toMatchObject({
      source: 'LH',
      trigger: 'CLI',
      status: 'SUCCEEDED',
      finishedAt: NOW,
      fetchedCount: 1,
      createdCount: 1,
      updatedCount: 0,
      failedCount: 0,
      errorMessage: null,
    });
  });

  it('한 번 받은 공고는 다음 실행에서 다른 지역 목록에 먼저 나와도 처음 받은 지역으로 받는다', async () => {
    const permanent = fixture('permanent-multi-complex');
    await run(runnerOf(new FakeLh().list('41', '06', permanent)));

    const both = new FakeLh().list('11', '06', permanent).list('41', '06', permanent);
    await run(runnerOf(both, { now: hoursAfter(1) }), true);

    expect(both.fetched).toEqual([`${PERMANENT_KEY}@41`]);
  });

  it('수집 범위 밖·모르는 유형·모르는 연계시스템은 목록 행만 보고 걸러 상세를 부르지 않는다', async () => {
    const unknownType = withRow(fixture('vacant-sale'), { AIS_TP_CD: '99' });
    const unknownLinkSystem = withRow(fixture('newlywed-sale'), { CCR_CNNT_SYS_DS_CD: '01' });
    const lh = new FakeLh()
      .list('11', '06', fixture('national-corrected-suffix'))
      .list('11', '13', fixture('jeonse-lease'), fixture('purchase-operator-recruit'))
      .list('11', '05', unknownType)
      .list('11', '39', unknownLinkSystem)
      .list('28', '06', fixture('daycare'))
      .list('28', '05', fixture('sale'));

    const summary = await run(runnerOf(lh));

    expect(lh.fetched.sort()).toEqual([`${SALE_KEY}@28`, `${NATIONAL_KEY}@11`]);
    expect(summary).toMatchObject({ status: 'SUCCEEDED', listed: 7, excluded: 3, unclassified: 2, created: 2 });
    const unclassified = await prisma.syncFailure.findMany({
      where: { errorCode: 'UNCLASSIFIED_TYPE' },
      orderBy: { sourceKey: 'asc' },
    });
    expect(unclassified.map((row) => [row.sourceKey, row.stage, row.level])).toEqual([
      ['01:0000060903', 'NORMALIZE', 'WARNING'],
      ['03:2015122300018175', 'NORMALIZE', 'WARNING'],
    ]);
    expect(unclassified[1].payload).toMatchObject({ queryRegion: '11', notice: { AIS_TP_CD: '99' } });
  });

  it('목록·상세·정규화·저장 실패는 공고마다 ERROR로 남기고 나머지는 저장한다(PARTIAL)', async () => {
    const emptyDetail = { ...fixture('happy-corrected'), detail: [] };
    const lh = new FakeLh()
      .list('11', '06', fixture('permanent-multi-complex'), fixture('national-corrected-suffix'), emptyDetail)
      .list('11', '13', fixture('purchase-youth-building-names'));
    lh.failingLists.add('41:13');
    lh.failingNotices.add(NATIONAL_KEY);
    const writer = new FlakyWriter(
      prisma,
      new Map([
        [PERMANENT_KEY, 1],
        ['03:2015122300020759', 2],
      ]),
    );

    const summary = await run(runnerOf(lh, { writer }));

    expect(summary).toMatchObject({ status: 'PARTIAL', listed: 4, fetched: 3, created: 1, failed: 4 });
    expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).failedCount).toBe(4);
    const failures = await openFailures();
    expect(failures.map((row) => [row.sourceKey, row.stage, row.level, row.errorCode])).toEqual([
      [NATIONAL_KEY, 'FETCH', 'ERROR', 'NETWORK'],
      ['03:2015122300020605', 'FETCH', 'ERROR', 'DETAIL_EMPTY'],
      ['03:2015122300020759', 'SAVE', 'ERROR', 'WRITE_FAILED'],
      ['list:41:13', 'FETCH', 'ERROR', 'HTTP_500'],
    ]);
    expect(failures[0].payload).toMatchObject({ queryRegion: '11', notice: { PAN_ID: '2015122300018941' } });
    expect(failures[2]).toMatchObject({ errorMessage: 'deadlock detected', payload: { queryRegion: '11' } });
    expect(await prisma.notice.count()).toBe(1);
  });

  it('다시 돌리면 바뀌지 않은 마감 공고는 다시 부르지 않고, 다시 난 실패는 retry_count만 올리며, 고쳐진 실패는 닫는다', async () => {
    const permanent = fixture('permanent-multi-complex');
    const national = fixture('national-corrected-suffix');
    const sale = fixture('sale');
    const lh = new FakeLh().list('11', '06', permanent, national).list('28', '05', sale);
    lh.failingLists.add('41:13');
    lh.failingNotices.add(NATIONAL_KEY);
    const first = await run(runnerOf(lh));
    expect(first).toMatchObject({ status: 'PARTIAL', created: 2, failed: 2 });

    // 1시간 뒤: 마감 공고·접수 중이지만 최근에 받은 공고는 건너뛰고, 저장하지 못한 공고만 다시 받는다
    lh.fetched.length = 0;
    lh.failingLists.clear();
    const second = await run(runnerOf(lh, { now: hoursAfter(1) }));
    expect(lh.fetched).toEqual([`${NATIONAL_KEY}@11`]);
    expect(second).toMatchObject({ status: 'PARTIAL', skipped: 2, fetched: 0, failed: 1 });
    expect((await openFailures()).map((row) => [row.sourceKey, row.retryCount, row.syncRunId])).toEqual([
      [NATIONAL_KEY, 1, second.runId],
    ]);
    expect(await prisma.syncFailure.findFirstOrThrow({ where: { sourceKey: 'list:41:13' } })).toMatchObject({
      resolvedAt: hoursAfter(1),
    });

    // 21시간 뒤: 마감 공고는 그대로 건너뛰고, 접수 중인 공고와 고쳐진 공고를 받는다
    lh.fetched.length = 0;
    lh.failingNotices.clear();
    const third = await run(runnerOf(lh, { now: hoursAfter(21) }));
    expect(lh.fetched.sort()).toEqual([`${SALE_KEY}@28`, `${NATIONAL_KEY}@11`]);
    expect(third).toMatchObject({ status: 'SUCCEEDED', skipped: 1, created: 1, updated: 1, failed: 0 });
    expect(await openErrorCount()).toBe(0);
    expect(await prisma.syncFailure.findFirstOrThrow({ where: { errorCode: 'NETWORK' } })).toMatchObject({
      resolvedAt: hoursAfter(21),
    });
    const refreshed = await prisma.noticeSource.findUniqueOrThrow({
      where: { source_sourceKey: { source: 'LH', sourceKey: SALE_KEY } },
    });
    expect(refreshed.fetchedAt).toEqual(hoursAfter(21));
  });

  it('목록 행이 바뀐 공고는 마감이어도 다시 받는다', async () => {
    const permanent = fixture('permanent-multi-complex');
    await run(runnerOf(new FakeLh().list('11', '06', permanent)));

    const changed = new FakeLh().list('11', '06', withRow(permanent, { DTL_URL: `${permanent.notice.DTL_URL}&v=2` }));
    const summary = await run(runnerOf(changed, { now: hoursAfter(1) }));

    expect(changed.fetched).toEqual([`${PERMANENT_KEY}@11`]);
    expect(summary).toMatchObject({ skipped: 0, updated: 1 });
  });

  it('이미 저장한 공고의 갱신이 실패하면 목록 행이 그대로여도 다음 실행에서 다시 받는다', async () => {
    const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));
    await run(runnerOf(lh));
    const failedUpdate = await run(
      runnerOf(lh, { now: hoursAfter(1), writer: new FlakyWriter(prisma, new Map([[PERMANENT_KEY, 2]])) }),
      true,
    );
    expect(failedUpdate).toMatchObject({ status: 'FAILED', failed: 1 });

    lh.fetched.length = 0;
    const retried = await run(runnerOf(lh, { now: hoursAfter(2) }));

    expect(lh.fetched).toEqual([`${PERMANENT_KEY}@11`]);
    expect(retried).toMatchObject({ status: 'SUCCEEDED', skipped: 0, updated: 1 });
    expect(await openErrorCount()).toBe(0);
  });

  it('받았지만 수집 지역 안에 남는 칸이 없는 공고는 기록해 두고, 목록 행이 같으면 다시 받지 않는다', async () => {
    const outOfRegion = fixture('permanent-multi-complex', [['서울특별시', '충청남도']]);
    const lh = new FakeLh().list('11', '06', outOfRegion);
    const first = await run(runnerOf(lh));
    expect(first).toMatchObject({ status: 'SUCCEEDED', fetched: 1, excluded: 1, created: 0 });
    expect(await prisma.syncFailure.findFirstOrThrow({ where: { errorCode: 'NO_LISTING_IN_REGION' } })).toMatchObject({
      sourceKey: PERMANENT_KEY,
      level: 'WARNING',
      payload: { queryRegion: '11', notice: { PAN_ID: '2015122300019045' } },
    });

    lh.fetched.length = 0;
    const second = await run(runnerOf(lh, { now: hoursAfter(1) }));

    expect(lh.fetched).toEqual([]);
    expect(second).toMatchObject({ skipped: 1, fetched: 0 });
  });

  it('--full이면 바뀌지 않은 공고도 다시 받는다', async () => {
    const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));
    await run(runnerOf(lh));
    lh.fetched.length = 0;
    const summary = await run(runnerOf(lh, { now: hoursAfter(1) }), true);
    expect(lh.fetched).toEqual([`${PERMANENT_KEY}@11`]);
    expect(summary).toMatchObject({ skipped: 0, updated: 1 });
  });

  it('같은 원천이 돌고 있으면 시작하지 않고, 오래 남은 RUNNING은 FAILED로 정리한 뒤 시작한다', async () => {
    const running = await prisma.syncRun.create({
      data: { source: 'LH', trigger: 'SCHEDULE', status: 'RUNNING', startedAt: hoursAfter(-1) },
    });
    const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));

    await expect(run(runnerOf(lh))).rejects.toBeInstanceOf(SyncAlreadyRunningError);
    expect(await prisma.syncRun.count()).toBe(1);

    await prisma.syncRun.update({ where: { id: running.id }, data: { startedAt: hoursAfter(-4) } });
    const summary = await run(runnerOf(lh));
    expect(summary.status).toBe('SUCCEEDED');
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: running.id } })).toMatchObject({
      status: 'FAILED',
      finishedAt: NOW,
    });
  });

  it('다음 실행이 이미 FAILED로 정리한 실행은 끝나도 그 기록을 덮어쓰지 않는다', async () => {
    const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));
    lh.beforeFetch = async () => {
      await prisma.syncRun.updateMany({ data: { status: 'FAILED', errorMessage: '다음 실행이 정리했다' } });
    };
    const logs: string[] = [];

    const summary = await run(runnerOf(lh, { logs }));

    expect(summary.created).toBe(1);
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).toMatchObject({
      status: 'FAILED',
      errorMessage: '다음 실행이 정리했다',
    });
    expect(logs.some((message) => message.includes('다음 실행이 FAILED로 정리했다'))).toBe(true);
  });

  it('목록 조회가 모두 실패하면 FAILED로 끝내고 상세를 부르지 않는다', async () => {
    const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));
    lh.listsDown = true;

    const summary = await run(runnerOf(lh));

    expect(summary).toMatchObject({ status: 'FAILED', listed: 0, failed: LIST_COMBINATIONS });
    expect(lh.fetched).toEqual([]);
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).toMatchObject({
      status: 'FAILED',
      failedCount: LIST_COMBINATIONS,
      errorMessage: '목록 조회가 모두 실패했다',
    });
  });

  it('목록 조합만 실패하면 PARTIAL이고, 2쪽 이후 실패도 같은 기록의 retry_count를 올린다', async () => {
    const jeonse = fixture('jeonse-lease');
    const fullPage = Array.from({ length: LH_PAGE_SIZE }, (_, index) => withRow(jeonse, { PAN_ID: `J${index}` }));
    const lh = new FakeLh().list('11', '13', ...fullPage);
    lh.failingPages.add('11:13:2');

    const first = await run(runnerOf(lh));
    expect(first).toMatchObject({ status: 'PARTIAL', listed: LH_PAGE_SIZE, excluded: LH_PAGE_SIZE, failed: 1 });
    await run(runnerOf(lh, { now: hoursAfter(1) }));

    expect((await openFailures()).map((row) => [row.sourceKey, row.errorCode, row.retryCount])).toEqual([
      ['list:11:13', 'HTTP_500', 1],
    ]);
  });

  it('예상하지 못한 오류는 다른 일꾼이 하던 공고를 마칠 때까지 기다린 뒤 실행을 FAILED로 닫고 던진다', async () => {
    const lh = new FakeLh().list(
      '11',
      '06',
      fixture('permanent-multi-complex'),
      fixture('national-corrected-suffix'),
      fixture('happy-corrected'),
    );
    lh.slowNotices.add(PERMANENT_KEY);
    lh.slowNotices.add(NATIONAL_KEY);
    lh.unexpectedErrors.set('03:2015122300020605', new Error('예상 못 한 오류'));

    await expect(run(runnerOf(lh))).rejects.toThrow('예상 못 한 오류');

    expect(await prisma.notice.count()).toBe(2);
    expect(await prisma.syncRun.findFirstOrThrow()).toMatchObject({
      status: 'FAILED',
      finishedAt: NOW,
      errorMessage: '예상 못 한 오류',
    });
  });

  it('시간 한도를 넘기면 남은 공고와 단지는 다음 실행에 넘긴다', async () => {
    let clock = NOW;
    const lh = new FakeLh().list(
      '11',
      '06',
      fixture('permanent-multi-complex'),
      fixture('national-corrected-suffix'),
      fixture('happy-corrected'),
    );
    lh.beforeFetch = () => {
      clock = hoursAfter(3);
    };
    const geocoder = new FakeGeocoder(() => null);

    const summary = await run(runnerOf(lh, { clock: () => clock, geocoder }));

    expect(summary).toMatchObject({ status: 'SUCCEEDED', fetched: 1, deferred: 2, geocodeStopped: 'TIME_BUDGET' });
    expect(geocoder.queries).toEqual([]);
    expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).errorMessage).toBe(
      '시간 한도로 공고 2건을 다음 실행에 넘겼다',
    );
  });

  describe('단지 좌표', () => {
    const GANGNAM_KEY = '서울특별시 강남구 자곡로3길 22';
    const UMYEON_KEY = '서울특별시 서초구 바우뫼로7길 11';
    const UMYEON_ADDRESS = '서울특별시 서초구 바우뫼로7길 11(우면동,우면주공아파트)';
    const POINT = { lat: 37.47, lng: 127.09 };
    const PERMANENT_COMPLEXES = 7;

    it('판별 키(정리한 주소) → 원문 주소 순으로 찾고, 둘 다 못 찾으면 NOT_FOUND로 남긴다', async () => {
      const geocoder = new FakeGeocoder((address) => ([GANGNAM_KEY, UMYEON_ADDRESS].includes(address) ? POINT : null));
      const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));

      const summary = await run(runnerOf(lh, { geocoder }));

      expect(summary).toMatchObject({ geocoded: 2, notFound: 5, warnings: 0, geocodeStopped: null });
      expect(geocoder.queries.filter((query) => query.includes('바우뫼로'))).toEqual([UMYEON_KEY, UMYEON_ADDRESS]);
      const complexes = await prisma.complex.findMany({ select: { addressKey: true, geocodeStatus: true } });
      const located = complexes
        .filter((complex) => complex.geocodeStatus === 'OK')
        .map((complex) => complex.addressKey);
      expect(located.sort()).toEqual([GANGNAM_KEY, UMYEON_KEY]);
      expect(complexes.filter((complex) => complex.geocodeStatus === 'NOT_FOUND')).toHaveLength(5);

      // 이미 판정한 단지는 다시 부르지 않는다
      geocoder.queries.length = 0;
      await run(runnerOf(lh, { geocoder, now: hoursAfter(1) }));
      expect(geocoder.queries).toEqual([]);
    });

    it('호출 한도를 넘으면 남은 단지를 부르지 않고 경고로 남겼다가, 다음 실행에서 좌표를 얻으면 닫는다', async () => {
      const quotaExceeded = failingGeocoder('QUOTA_EXCEEDED');
      const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));

      const first = await run(runnerOf(lh, { geocoder: quotaExceeded }));

      expect(quotaExceeded.queries).toHaveLength(1);
      expect(first).toMatchObject({ status: 'SUCCEEDED', geocoded: 0, warnings: 1, geocodeStopped: 'QUOTA_EXCEEDED' });
      const [warning] = await openFailures();
      expect(warning).toMatchObject({ stage: 'GEOCODE', level: 'WARNING', errorCode: 'QUOTA_EXCEEDED' });
      expect(warning.sourceKey).toMatch(/^complex:/);
      expect(await prisma.complex.count({ where: { geocodeStatus: null } })).toBe(PERMANENT_COMPLEXES);

      const second = await run(runnerOf(lh, { geocoder: new FakeGeocoder(() => POINT), now: hoursAfter(1) }));
      expect(second).toMatchObject({ geocoded: PERMANENT_COMPLEXES, warnings: 0, geocodeStopped: null });
      expect(await openFailures()).toEqual([]);
    });

    it('서비스 오류가 연달아 5번 나면 남은 단지마다 경고를 쌓지 않고 멈춘다', async () => {
      const unavailable = failingGeocoder('HTTP_503');
      const lh = new FakeLh().list('11', '06', fixture('permanent-multi-complex'));

      const summary = await run(runnerOf(lh, { geocoder: unavailable }));

      expect(unavailable.queries).toHaveLength(5);
      expect(summary).toMatchObject({ warnings: 5, geocodeStopped: 'CONSECUTIVE_FAILURES' });
    });
  });
});
