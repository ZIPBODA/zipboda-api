import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client.js';
import { normalizeApplyhomeNotice } from '../src/modules/subscription/sync/applyhome/applyhome-normalizer.js';
import { applyhomeBundleOf } from '../src/modules/subscription/sync/applyhome/applyhome-raw.js';
import { normalizeLhNotice } from '../src/modules/subscription/sync/lh/lh-normalizer.js';
import { lhBundleOf } from '../src/modules/subscription/sync/lh/lh-raw.js';
import type { NormalizedNotice } from '../src/modules/subscription/sync/normalized-notice.js';
import { NoticeWriter } from '../src/modules/subscription/sync/notice-writer.js';

const FETCHED_AT = new Date('2026-11-10T00:00:00Z');

interface Fixture {
  notice: NormalizedNotice;
  raw: unknown;
}

const editedText = (directory: string, name: string, edits: [string, string][]) =>
  edits.reduce(
    (current, [from, to]) => {
      if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
      return current.replaceAll(from, to);
    },
    readFileSync(path.join(process.cwd(), 'test', 'fixtures', directory, `${name}.json`), 'utf8'),
  );

/** 청약홈 실제 응답(test/fixtures/applyhome)을 원문 일부만 바꿔 정규화한다 */
const fixtureOf = (name: string, edits: [string, string][] = []): Fixture => {
  const raw: unknown = JSON.parse(editedText('applyhome', name, edits));
  const result = normalizeApplyhomeNotice(applyhomeBundleOf(raw));
  if (result.kind !== 'notice') throw new Error(`${name}이 공고가 아니라 ${result.kind}로 정규화됐습니다`);
  return { notice: result.notice, raw };
};

/** LH 실제 응답(test/fixtures/lh) — 원천 간 같은 공고를 잇는 상대 */
const lhFixtureOf = (name: string, edits: [string, string][] = []): Fixture => {
  const raw: unknown = JSON.parse(editedText('lh', name, edits));
  const result = normalizeLhNotice(lhBundleOf(raw));
  if (result.kind !== 'notice') throw new Error(`${name}이 공고가 아니라 ${result.kind}로 정규화됐습니다`);
  return { notice: result.notice, raw };
};

/** 경쟁률이 있는 청약홈 공고처럼 신청 인원을 채운다(분양전환 임대 테스트 자료는 경쟁률이 없다) */
const withApplicationCounts = ({ notice, raw }: Fixture, listingCount: number): Fixture => ({
  raw,
  notice: {
    ...notice,
    listings: notice.listings.map((listing) => ({
      ...listing,
      applicationCount: listingCount,
      units: listing.units.map((unit) => ({
        ...unit,
        applicationCount: Math.floor(listingCount / listing.units.length),
      })),
    })),
  },
});

/** 같은 공고: LH '[정정공고][정정공고]군포대야미 A-1블록 6년 분양전환공공임대주택' ↔ 청약홈 '군포대야미지구 A-1블록 6년 …(본청약)'(2026-06-30) */
const LH_RENTAL = 'public-rental-6y';
const APPLYHOME_RENTAL = 'apt-lh-convertible-rental';
const LH_TITLE = '[정정공고][정정공고]군포대야미 A-1블록 6년 분양전환공공임대주택 입주자모집공고';

/** 수집 범위 안인 테스트 자료 — 기관 4곳·다섯 갈래 중 네 갈래·분양전환 임대를 모두 담는다 */
const COLLECTED = [
  'apt-lh-public-sale',
  'apt-lh-newlywed',
  'apt-lh-convertible-rental',
  'apt-lh-private-participation',
  'apt-gh-public-sale',
  'apt-gh-shared-equity',
  'apt-gh-private',
  'apt-ih-consortium',
  'apt-sh-land-lease',
  'remndr-gh-national',
  'remndr-lh-consortium',
  'opt-lh',
  'urbty-lh-officetel',
];

describe('청약홈 공고 저장 (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const writer = new NoticeWriter(prisma);
  const write = ({ notice, raw }: Fixture) => writer.write(notice, raw, FETCHED_AT);
  const sourcesOf = (noticeId: string) =>
    prisma.noticeSource.findMany({
      where: { noticeId },
      select: { source: true, isPrimary: true },
      orderBy: { source: 'asc' },
    });

  const clean = async () => {
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

  it('수집 범위 안의 청약홈 공고는 모두 DB 제약을 지키며 공고·원천·칸·일정·주택형으로 저장된다', async () => {
    for (const name of COLLECTED) {
      const result = await write(fixtureOf(name));
      expect(result).toMatchObject({ createdNotice: true, primary: true, warnings: [] });
    }
    expect(await prisma.notice.count()).toBe(COLLECTED.length);
    expect(await prisma.noticeSource.count({ where: { source: 'APPLYHOME', isPrimary: true } })).toBe(COLLECTED.length);
    expect(await prisma.subscription.count()).toBe(COLLECTED.length);
    const agencies = await prisma.notice.groupBy({ by: ['agencyCode'], _count: true, orderBy: { agencyCode: 'asc' } });
    expect(agencies.map((row) => [row.agencyCode, row._count])).toEqual([
      [1, 7],
      [2, 1],
      [3, 4],
      [4, 1],
    ]);
  });

  it('공고·칸·주택형 값: 원천 키·게시일·접수 요약·주택형(만원 → 원)', async () => {
    const { noticeId } = await write(fixtureOf('apt-lh-public-sale'));
    const notice = await prisma.notice.findUniqueOrThrow({
      where: { id: noticeId },
      include: { sources: true, subscriptions: { include: { units: true, schedules: true, complex: true } } },
    });
    expect(notice).toMatchObject({
      agencyCode: 1,
      supplyCategory: 'SALE',
      origin: 'SYNC',
      postDate: new Date('2026-10-23T00:00:00Z'),
    });
    expect(notice.sources).toEqual([
      expect.objectContaining({ source: 'APPLYHOME', sourceKey: '2026000531:2026000531', correctionMarks: 0 }),
    ]);
    const [subscription] = notice.subscriptions;
    expect(subscription).toMatchObject({
      regionCode: 3,
      applyStartDate: new Date('2026-11-02T00:00:00Z'),
      applyEndDate: new Date('2026-11-17T00:00:00Z'),
      supplyUnits: 105,
    });
    expect(subscription.complex).toMatchObject({ name: '시흥거모지구 S-1블록 공공분양', addressKey: null });
    expect(subscription.units.map((unit) => [unit.label, unit.salePriceWon]).sort()).toEqual([
      ['59.8000B', 410_420_000n],
      ['59.9000A', 411_100_000n],
      ['84.8900A', 570_260_000n],
    ]);
  });

  it('분양전환 가능 임대의 금액은 임대보증금 열에 저장된다', async () => {
    await write(fixtureOf('apt-lh-convertible-rental'));
    const unit = await prisma.subscriptionUnit.findFirstOrThrow({ where: { label: '55.0000A' } });
    expect(unit).toMatchObject({ depositWon: 85_610_000n, salePriceWon: null });
  });

  it('같은 지번의 공공분양·지분적립형 공고는 한 단지를 쓰고, 블록 주소의 n차 공고는 이름 별칭으로 같은 단지를 쓴다', async () => {
    await write(fixtureOf('apt-gh-public-sale'));
    await write(fixtureOf('apt-gh-shared-equity'));
    await write(fixtureOf('opt-lh'));
    await write(
      fixtureOf('opt-lh', [
        ['2026940191', '2026940218'],
        ['고덕신도시 아테라 A-63블록 공공분양주택', '고덕신도시 아테라 A-63블록 공공분양주택(2차)'],
      ]),
    );
    const complexes = await prisma.complex.findMany({
      select: {
        name: true,
        addressKey: true,
        aliases: { select: { method: true } },
        _count: { select: { subscriptions: true } },
      },
      orderBy: { name: 'asc' },
    });
    expect(complexes).toHaveLength(2);
    const byAddress = complexes.find((complex) => complex.addressKey === '경기도 수원시 영통구 원천동 633');
    expect(byAddress?._count.subscriptions).toBe(2);
    expect(complexes.find((complex) => complex.addressKey === null)).toEqual({
      name: '고덕신도시 아테라 A-63블록 공공분양주택',
      addressKey: null,
      aliases: [{ method: 'NAME' }],
      _count: { subscriptions: 2 },
    });
  });

  it('같은 공고를 다시 받아도 행이 늘지 않는다', async () => {
    const first = await write(fixtureOf('apt-ih-consortium'));
    const second = await write(fixtureOf('apt-ih-consortium'));
    expect(second).toMatchObject({ noticeId: first.noticeId, createdNotice: false, primary: true });
    expect(second.subscriptionIds).toEqual(first.subscriptionIds);
    expect(await prisma.subscriptionUnit.count()).toBe(6);
  });

  describe('신청 인원', () => {
    it('청약홈이 우선 원천인 공고는 칸·주택형의 신청 인원을 저장한다', async () => {
      const { noticeId } = await write(fixtureOf('apt-ih-consortium'));
      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { noticeId },
        include: { units: true },
      });
      expect(subscription.applicationCount).toBe(3537);
      expect(subscription.units.find((unit) => unit.label === '60.9495A')?.applicationCount).toBe(466);
    });

    it('신청 인원을 정하지 않는 원천(LH)이 다시 써도 청약홈이 채운 신청 인원을 지우지 않는다(ERD §5 규칙 12·13)', async () => {
      const { noticeId } = await write(lhFixtureOf(LH_RENTAL));
      const subscription = await prisma.subscription.findFirstOrThrow({
        where: { noticeId },
        include: { units: true },
      });
      await prisma.subscription.update({ where: { id: subscription.id }, data: { applicationCount: 77 } });
      await prisma.subscriptionUnit.update({ where: { id: subscription.units[0].id }, data: { applicationCount: 7 } });

      await write(lhFixtureOf(LH_RENTAL));

      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } })).applicationCount).toBe(
        77,
      );
      expect(
        (await prisma.subscriptionUnit.findUniqueOrThrow({ where: { id: subscription.units[0].id } })).applicationCount,
      ).toBe(7);
    });
  });

  describe('원천이 다른 같은 공고(ERD §5 규칙 19)', () => {
    it('LH 공고 뒤에 청약홈이 오면 같은 공고에 참조만 더하고 값은 LH 그대로다', async () => {
      const lh = await write(lhFixtureOf(LH_RENTAL));
      const applyhome = await write(fixtureOf(APPLYHOME_RENTAL));

      expect(applyhome).toMatchObject({ noticeId: lh.noticeId, createdNotice: false, primary: false, warnings: [] });
      expect(await sourcesOf(lh.noticeId)).toEqual([
        { source: 'APPLYHOME', isPrimary: false },
        { source: 'LH', isPrimary: true },
      ]);
      expect(await prisma.notice.count()).toBe(1);
      expect((await prisma.notice.findUniqueOrThrow({ where: { id: lh.noticeId } })).title).toBe(LH_TITLE);
      expect(await prisma.subscription.findMany({ where: { noticeId: lh.noticeId }, select: { id: true } })).toEqual(
        lh.subscriptionIds.map((id) => ({ id })),
      );
    });

    it('청약홈이 먼저 오면 청약홈 값으로 만들었다가, LH가 오면 같은 공고의 우선 원천이 된다', async () => {
      const applyhome = await write(fixtureOf(APPLYHOME_RENTAL));
      const lh = await write(lhFixtureOf(LH_RENTAL));

      expect(lh).toMatchObject({ noticeId: applyhome.noticeId, createdNotice: false, primary: true });
      expect(await sourcesOf(applyhome.noticeId)).toEqual([
        { source: 'APPLYHOME', isPrimary: false },
        { source: 'LH', isPrimary: true },
      ]);
      expect((await prisma.notice.findUniqueOrThrow({ where: { id: applyhome.noticeId } })).title).toBe(LH_TITLE);
    });

    it('분류나 신혼희망 여부가 다르면 같은 날·같은 블록이어도 잇지 않는다', async () => {
      await write(lhFixtureOf(LH_RENTAL));
      const sale = await write(fixtureOf(APPLYHOME_RENTAL, [['"RENT_SECD": "1"', '"RENT_SECD": "0"']]));
      const newlywed = await write(
        fixtureOf(APPLYHOME_RENTAL, [
          ['2026000307', '2026000999'],
          ['6년 분양전환공공임대주택(본청약)', '6년 분양전환공공임대주택 신혼희망타운(본청약)'],
        ]),
      );

      expect(sale.createdNotice).toBe(true);
      expect(newlywed.createdNotice).toBe(true);
      expect(await prisma.notice.count()).toBe(3);
    });

    it('후보가 둘 이상이면 어느 공고인지 몰라 잇지 않고 경고를 남긴다', async () => {
      await write(lhFixtureOf(LH_RENTAL));
      await write(
        lhFixtureOf(LH_RENTAL, [
          ['0000061132', '0000061999'],
          ['분양전환공공임대주택 입주자모집공고', '분양전환공공임대주택 추가 입주자모집공고'],
        ]),
      );

      const applyhome = await write(fixtureOf(APPLYHOME_RENTAL));

      expect(applyhome).toMatchObject({
        createdNotice: true,
        warnings: [
          {
            stage: 'MATCH',
            code: 'CROSS_SOURCE_AMBIGUOUS',
            message: '다른 원천의 같은 공고 후보가 2건이라 새 공고로 두었다',
          },
        ],
      });
    });

    it('이어지지 않은 후보가 하나여도 이미 이어진 같은 현장 공고가 있으면 어느 쪽인지 몰라 잇지 않는다', async () => {
      await write(lhFixtureOf(LH_RENTAL));
      await write(fixtureOf(APPLYHOME_RENTAL));
      await write(
        lhFixtureOf(LH_RENTAL, [
          ['0000061132', '0000061999'],
          ['분양전환공공임대주택 입주자모집공고', '분양전환공공임대주택 추가 입주자모집공고'],
        ]),
      );

      const another = await write(fixtureOf(APPLYHOME_RENTAL, [['2026000307', '2026000998']]));

      expect(another).toMatchObject({
        createdNotice: true,
        warnings: [{ stage: 'MATCH', code: 'CROSS_SOURCE_TAKEN' }],
      });
    });

    it('이미 청약홈 원천이 붙은 LH 공고와 같은 현장이면 받는 순서로 차지하지 않게 잇지 않고 경고한다', async () => {
      const lh = await write(lhFixtureOf(LH_RENTAL));
      await write(fixtureOf(APPLYHOME_RENTAL));
      const another = await write(fixtureOf(APPLYHOME_RENTAL, [['2026000307', '2026000998']]));

      expect(another).toMatchObject({
        createdNotice: true,
        warnings: [{ stage: 'MATCH', code: 'CROSS_SOURCE_TAKEN' }],
      });
      expect(another.noticeId).not.toBe(lh.noticeId);
    });

    it('청약홈으로 먼저 만든 공고를 LH가 넘겨받으면, 같은 단지라 칸이 남아도 청약홈이 센 신청 인원을 비운다', async () => {
      // 두 원천이 같은 지번 주소를 주면 같은 단지로 판별돼 칸(id)이 그대로 남는다 — 신청 인원만 남으면 LH 공급 세대와 범위가 어긋난다
      const sameLot: [string, string][] = [
        ['"LCT_ARA_ADR": "경기도 군포시 둔대동"', '"LCT_ARA_ADR": "경기도 군포시 둔대동 100"'],
      ];
      const applyhome = await write(
        withApplicationCounts(
          fixtureOf(APPLYHOME_RENTAL, [
            [
              '경기도 군포시 대야미동, 속달동, 둔대동 일원 군포대야미 공공주택지구내 A1블록',
              '경기도 군포시 둔대동 100 군포대야미 A-1BL',
            ],
          ]),
          3000,
        ),
      );
      const [kept] = applyhome.subscriptionIds;

      const lh = await write(lhFixtureOf(LH_RENTAL, sameLot));

      expect(lh).toMatchObject({ noticeId: applyhome.noticeId, primary: true, subscriptionIds: [kept] });
      const subscription = await prisma.subscription.findUniqueOrThrow({
        where: { id: kept },
        include: { units: true },
      });
      expect(subscription.applicationCount).toBeNull();
      expect(subscription.units.every((unit) => unit.applicationCount === null)).toBe(true);
    });

    it('청약홈이 보조 원천이면 신청 인원을 옮기지 않고, 있던 신청 인원은 경고로 남긴다', async () => {
      await write(lhFixtureOf(LH_RENTAL));
      const applyhome = await write(withApplicationCounts(fixtureOf(APPLYHOME_RENTAL), 3000));

      expect(applyhome).toMatchObject({
        primary: false,
        warnings: [
          {
            stage: 'MATCH',
            code: 'APPLICATION_COUNT_NOT_APPLIED',
            message: '우선 원천이 다른 공고라 신청 인원(3000명)을 칸에 옮기지 않았다',
          },
        ],
      });
      expect(await prisma.subscription.count({ where: { applicationCount: { not: null } } })).toBe(0);
    });
  });
});
