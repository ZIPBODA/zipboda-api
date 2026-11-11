import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client.js';
import {
  ApplyhomeApiError,
  type ApplyhomeListQuery,
} from '../src/modules/subscription/sync/applyhome/applyhome-api.client.js';
import {
  applyhomeBundleOf,
  type ApplyhomeBundle,
  type ApplyhomeRow,
} from '../src/modules/subscription/sync/applyhome/applyhome-raw.js';
import {
  ApplyhomeSyncRunner,
  type ApplyhomeSource,
} from '../src/modules/subscription/sync/applyhome/applyhome-sync-runner.js';
import {
  APPLYHOME_PAGE_SIZE,
  type ApplyhomeKind,
} from '../src/modules/subscription/sync/applyhome/applyhome.constants.js';
import { normalizeLhNotice } from '../src/modules/subscription/sync/lh/lh-normalizer.js';
import { lhBundleOf } from '../src/modules/subscription/sync/lh/lh-raw.js';
import type { Geocoder } from '../src/modules/subscription/sync/geocode/kakao-geocoder.js';
import type { NormalizedNotice } from '../src/modules/subscription/sync/normalized-notice.js';
import { NoticeWriter, type WriteResult } from '../src/modules/subscription/sync/notice-writer.js';
import { SyncRunRecorder } from '../src/modules/subscription/sync/sync-run-recorder.js';

const NOW = new Date('2026-11-11T00:00:00Z');
const HOUR_MS = 60 * 60 * 1000;
const hoursAfter = (hours: number) => new Date(NOW.getTime() + hours * HOUR_MS);

/** 갈래 다섯 개 */
const KIND_COUNT = 5;

const fixtureText = (directory: string, name: string, edits: [string, string][]) =>
  edits.reduce(
    (current, [from, to]) => {
      if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
      return current.replaceAll(from, to);
    },
    readFileSync(path.join(process.cwd(), 'test', 'fixtures', directory, `${name}.json`), 'utf8'),
  );

const bundleOf = (name: string, edits: [string, string][] = []): ApplyhomeBundle =>
  applyhomeBundleOf(JSON.parse(fixtureText('applyhome', name, edits)));

const keyOf = (detail: ApplyhomeRow) => `${detail.HOUSE_MANAGE_NO}:${detail.PBLANC_NO}`;

/** 청약홈 API 대신 저장해 둔 실제 응답을 돌려준다. 목록은 쪽 크기로 나눠 준다 */
class FakeApplyhome implements ApplyhomeSource {
  readonly failingKinds = new Set<ApplyhomeKind>();
  readonly failingNotices = new Set<string>();
  readonly fetched: string[] = [];
  listsDown = false;
  private readonly lists = new Map<ApplyhomeKind, ApplyhomeRow[]>();
  private readonly bundles = new Map<string, ApplyhomeBundle>();

  add(...bundles: ApplyhomeBundle[]): this {
    for (const bundle of bundles) {
      this.bundles.set(keyOf(bundle.detail), bundle);
      this.lists.set(bundle.kind, [...(this.lists.get(bundle.kind) ?? []), bundle.detail]);
    }
    return this;
  }

  listNotices({ kind, page }: ApplyhomeListQuery): Promise<ApplyhomeRow[]> {
    if (this.listsDown || this.failingKinds.has(kind)) {
      return Promise.reject(new ApplyhomeApiError('HTTP_500', `청약홈 ${kind} 목록이 500으로 응답했다`));
    }
    const rows = this.lists.get(kind) ?? [];
    return Promise.resolve(rows.slice((page - 1) * APPLYHOME_PAGE_SIZE, page * APPLYHOME_PAGE_SIZE));
  }

  bundleOf(kind: ApplyhomeKind, detail: ApplyhomeRow): Promise<ApplyhomeBundle> {
    const key = keyOf(detail);
    this.fetched.push(key);
    if (this.failingNotices.has(key)) return Promise.reject(new ApplyhomeApiError('NETWORK', '청약홈에 닿지 못했다'));
    const bundle = this.bundles.get(key);
    if (bundle === undefined) return Promise.reject(new Error(`테스트 목록에 없는 공고 ${key}`));
    return Promise.resolve({ ...bundle, kind, detail });
  }
}

/** 저장이 정해진 횟수만큼 실패한다(교착 등) */
class FlakyWriter extends NoticeWriter {
  constructor(
    prisma: PrismaClient,
    private failuresLeft: number,
  ) {
    super(prisma);
  }

  override write(notice: NormalizedNotice, raw: unknown, fetchedAt: Date): Promise<WriteResult> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      return Promise.reject(new Error('deadlock detected'));
    }
    return super.write(notice, raw, fetchedAt);
  }
}

describe('청약홈 수집 실행 (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

  const runnerOf = (
    applyhome: ApplyhomeSource,
    now = NOW,
    writer = new NoticeWriter(prisma),
    geocoder: Geocoder | null = null,
  ) =>
    new ApplyhomeSyncRunner({
      prisma,
      applyhome,
      writer,
      recorder: new SyncRunRecorder(prisma, () => now),
      geocoder,
      now: () => now,
      log: () => undefined,
    });
  const run = (runner: ApplyhomeSyncRunner, full = false) =>
    runner.run({ trigger: 'CLI', from: '20251101', to: '20261111', full });

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

  it('목록 단계에서 민간 사업·수집 지역 밖·분류표 밖을 걸러 주택형·경쟁률을 부르지 않고, 나머지를 저장한다', async () => {
    const applyhome = new FakeApplyhome().add(
      bundleOf('apt-lh-public-sale'),
      bundleOf('apt-gh-private'),
      bundleOf('apt-private-builder'),
      bundleOf('apt-lh-outside-region'),
      bundleOf('pblpvt-private'),
      bundleOf('opt-lh'),
      bundleOf('remndr-gh-national'),
      bundleOf('urbty-lh-officetel'),
      bundleOf('urbty-lh-officetel', [
        ['2026950013', '2026950099'],
        ['"HOUSE_DTL_SECD": "02"', '"HOUSE_DTL_SECD": "04"'],
      ]),
    );

    const summary = await run(runnerOf(applyhome));

    expect(applyhome.fetched.sort()).toEqual([
      '2025910271:2025910271',
      '2026000125:2026000125',
      '2026000531:2026000531',
      '2026940191:2026940191',
      '2026950013:2026950013',
    ]);
    expect(summary).toMatchObject({
      status: 'SUCCEEDED',
      listed: 9,
      excluded: 3,
      unclassified: 1,
      fetched: 5,
      created: 5,
      failed: 0,
    });
    expect(await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).toMatchObject({
      source: 'APPLYHOME',
      status: 'SUCCEEDED',
      createdCount: 5,
    });
    expect(await prisma.syncFailure.findFirstOrThrow({ where: { errorCode: 'UNCLASSIFIED_TYPE' } })).toMatchObject({
      source: 'APPLYHOME',
      sourceKey: '2026950099:2026950099',
      payload: { kind: 'URBTY', detail: { HOUSE_DTL_SECD: '04' } },
    });
  });

  it('LH에도 있는 공고는 LH 공고에 참조로 잇고, 청약홈이 센 신청 인원은 그대로 저장한다', async () => {
    const lh = JSON.parse(fixtureText('lh', 'public-rental-6y', [])) as unknown;
    const normalized = normalizeLhNotice(lhBundleOf(lh));
    if (normalized.kind !== 'notice') throw new Error('LH 테스트 자료가 공고가 아니다');
    const lhNotice = await new NoticeWriter(prisma).write(normalized.notice, lh, NOW);
    const applyhome = new FakeApplyhome().add(bundleOf('apt-lh-convertible-rental'), bundleOf('apt-ih-consortium'));

    const summary = await run(runnerOf(applyhome));

    expect(summary).toMatchObject({ status: 'SUCCEEDED', referenced: 1, created: 1 });
    expect(await prisma.noticeSource.count({ where: { noticeId: lhNotice.noticeId } })).toBe(2);
    expect(await prisma.notice.count()).toBe(2);
    const consortium = await prisma.subscription.findFirstOrThrow({
      where: { notice: { sources: { some: { sourceKey: '2026000404:2026000404' } } } },
    });
    expect(consortium.applicationCount).toBe(3537);
  });

  it('다시 돌리면 끝난 공고는 건너뛰고, 진행 중인 공고(계약이 아직 남음)는 20시간이 지나면 다시 받으며, 상세가 바뀐 공고는 바로 받는다', async () => {
    // 광교 A17: 계약 2026-12-21~23(진행 중) · 고덕 A4 무순위: 계약 2026-01-23(끝남)
    const applyhome = new FakeApplyhome().add(bundleOf('apt-gh-public-sale'), bundleOf('remndr-gh-national'));
    await run(runnerOf(applyhome));

    applyhome.fetched.length = 0;
    const second = await run(runnerOf(applyhome, hoursAfter(1)));
    expect(applyhome.fetched).toEqual([]);
    expect(second).toMatchObject({ skipped: 2, fetched: 0 });

    applyhome.fetched.length = 0;
    const third = await run(runnerOf(applyhome, hoursAfter(21)));
    expect(applyhome.fetched).toEqual(['2026000528:2026000528']);
    expect(third).toMatchObject({ skipped: 1, updated: 1 });

    const changed = new FakeApplyhome().add(
      bundleOf('apt-gh-public-sale'),
      bundleOf('remndr-gh-national', [['http://gd-hausd.com/', 'http://gd-hausd.com/new']]),
    );
    await run(runnerOf(changed, hoursAfter(22)));
    expect(changed.fetched).toEqual(['2025910271:2025910271']);
  });

  it('목록·주택형 실패는 ERROR로 남겨 다음 실행에서 다시 받고, 고쳐지면 닫는다', async () => {
    const applyhome = new FakeApplyhome().add(bundleOf('opt-lh'), bundleOf('remndr-gh-national'));
    applyhome.failingKinds.add('URBTY');
    applyhome.failingNotices.add('2025910271:2025910271');

    const first = await run(runnerOf(applyhome));

    expect(first).toMatchObject({ status: 'PARTIAL', created: 1, failed: 2 });
    const failures = await prisma.syncFailure.findMany({ where: { resolvedAt: null }, orderBy: { sourceKey: 'asc' } });
    expect(failures.map((row) => [row.sourceKey, row.stage, row.level, row.errorCode])).toEqual([
      ['2025910271:2025910271', 'FETCH', 'ERROR', 'NETWORK'],
      ['list:URBTY', 'FETCH', 'ERROR', 'HTTP_500'],
    ]);
    expect(failures[0].payload).toMatchObject({ kind: 'REMNDR', detail: { HOUSE_MANAGE_NO: '2025910271' } });

    applyhome.failingKinds.clear();
    applyhome.failingNotices.clear();
    applyhome.fetched.length = 0;
    const second = await run(runnerOf(applyhome, hoursAfter(1)));

    expect(applyhome.fetched).toEqual(['2025910271:2025910271']);
    expect(second).toMatchObject({ status: 'SUCCEEDED', created: 1, skipped: 1, failed: 0 });
    expect(await prisma.syncFailure.count({ where: { resolvedAt: null, level: 'ERROR' } })).toBe(0);
  });

  it('이미 저장한 공고의 갱신이 실패하면 끝난 공고라도 다음 실행에서 다시 받는다', async () => {
    const applyhome = new FakeApplyhome().add(bundleOf('remndr-gh-national'));
    await run(runnerOf(applyhome));
    const failedUpdate = await run(runnerOf(applyhome, hoursAfter(1), new FlakyWriter(prisma, 2)), true);
    expect(failedUpdate).toMatchObject({ status: 'FAILED', failed: 1 });

    applyhome.fetched.length = 0;
    const retried = await run(runnerOf(applyhome, hoursAfter(2)));

    expect(applyhome.fetched).toEqual(['2025910271:2025910271']);
    expect(retried).toMatchObject({ status: 'SUCCEEDED', skipped: 0, updated: 1 });
    expect(await prisma.syncFailure.count({ where: { resolvedAt: null, level: 'ERROR' } })).toBe(0);
  });

  it('끝난 공고라도 끝나기 전에 받은 것이면 끝난 뒤 한 번만 더 받는다 — 수집이 멈춘 사이 마지막 경쟁률을 잃지 않게', async () => {
    // 광교 A17: 가장 늦은 날은 계약 종료 2026-12-23
    const applyhome = new FakeApplyhome().add(bundleOf('apt-gh-public-sale'));
    await run(runnerOf(applyhome));

    applyhome.fetched.length = 0;
    await run(runnerOf(applyhome, new Date('2026-12-24T00:00:00Z')));
    expect(applyhome.fetched).toEqual(['2026000528:2026000528']);

    applyhome.fetched.length = 0;
    const later = await run(runnerOf(applyhome, new Date('2026-12-26T00:00:00Z')));
    expect(applyhome.fetched).toEqual([]);
    expect(later.skipped).toBe(1);
  });

  it('지난번에 받다 실패한 공고가 이제 수집 범위 밖이면 그 실패 기록을 닫는다', async () => {
    const applyhome = new FakeApplyhome().add(bundleOf('remndr-gh-national'));
    applyhome.failingNotices.add('2025910271:2025910271');
    await run(runnerOf(applyhome));
    expect(await prisma.syncFailure.count({ where: { resolvedAt: null, level: 'ERROR' } })).toBe(1);

    const nowPrivate = new FakeApplyhome().add(
      bundleOf('remndr-gh-national', [['"BSNS_MBY_NM": "경기주택도시공사"', '"BSNS_MBY_NM": "(주)민간건설"']]),
    );
    const summary = await run(runnerOf(nowPrivate, hoursAfter(1)));

    expect(summary).toMatchObject({ excluded: 1, fetched: 0 });
    expect(await prisma.syncFailure.count({ where: { resolvedAt: null } })).toBe(0);
  });

  it('LH 실행이 남긴 단지 좌표 경고도 청약홈 실행이 좌표를 얻으면 닫는다', async () => {
    const applyhome = new FakeApplyhome().add(bundleOf('remndr-gh-national'));
    await run(runnerOf(applyhome));
    const complex = await prisma.complex.findFirstOrThrow({ where: { addressKey: '경기도 평택시 고덕동 1858-2' } });
    const lhRecorder = new SyncRunRecorder(prisma, () => NOW);
    const lhRunId = await lhRecorder.start('LH', 'CLI');
    await lhRecorder.record(lhRunId, 'LH', `complex:${complex.id}`, 'WARNING', {
      stage: 'GEOCODE',
      code: 'QUOTA_EXCEEDED',
      message: '좌표를 얻지 못해 다음 실행에서 다시 시도한다',
    });
    await lhRecorder.finish(lhRunId, 'PARTIAL', { fetched: 0, created: 0, updated: 0, failed: 0 });
    const geocoder: Geocoder = { geocode: () => Promise.resolve({ lat: 36.99, lng: 127.03 }) };

    const summary = await run(runnerOf(applyhome, hoursAfter(1), new NoticeWriter(prisma), geocoder));

    expect(summary.geocoded).toBe(1);
    expect(await prisma.syncFailure.findFirstOrThrow({ where: { source: 'LH', stage: 'GEOCODE' } })).toMatchObject({
      resolvedAt: hoursAfter(1),
    });
  });

  it('목록 조회가 모두 실패하면 FAILED로 끝내고 주택형을 부르지 않는다', async () => {
    const applyhome = new FakeApplyhome().add(bundleOf('opt-lh'));
    applyhome.listsDown = true;

    const summary = await run(runnerOf(applyhome));

    expect(summary).toMatchObject({ status: 'FAILED', listed: 0, failed: KIND_COUNT });
    expect(applyhome.fetched).toEqual([]);
    expect((await prisma.syncRun.findUniqueOrThrow({ where: { id: summary.runId } })).errorMessage).toBe(
      '목록 조회가 모두 실패했다',
    );
  });
});
