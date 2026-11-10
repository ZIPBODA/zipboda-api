import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client.js';
import { normalizeApplyhomeNotice } from '../src/modules/subscription/sync/applyhome/applyhome-normalizer.js';
import { applyhomeBundleOf } from '../src/modules/subscription/sync/applyhome/applyhome-raw.js';
import { NoticeWriter } from '../src/modules/subscription/sync/notice-writer.js';

const FETCHED_AT = new Date('2026-11-10T00:00:00Z');

/** 청약홈 실제 응답(test/fixtures/applyhome)을 원문 일부만 바꿔 정규화한다 */
const fixtureOf = (name: string, edits: [string, string][] = []) => {
  const text = edits.reduce(
    (current, [from, to]) => {
      if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
      return current.replaceAll(from, to);
    },
    readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'applyhome', `${name}.json`), 'utf8'),
  );
  const raw: unknown = JSON.parse(text);
  const result = normalizeApplyhomeNotice(applyhomeBundleOf(raw));
  if (result.kind !== 'notice') throw new Error(`${name}이 공고가 아니라 ${result.kind}로 정규화됐습니다`);
  return { notice: result.notice, raw };
};

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
  const write = ({ notice, raw }: ReturnType<typeof fixtureOf>) => writer.write(notice, raw, FETCHED_AT);

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
});
