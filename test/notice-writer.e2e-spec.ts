import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/database/generated/client.js';
import { normalizeLhNotice } from '../src/modules/subscription/sync/lh/lh-normalizer.js';
import { lhBundleOf } from '../src/modules/subscription/sync/lh/lh-raw.js';
import type { NormalizedNotice } from '../src/modules/subscription/sync/normalized-notice.js';
import { NoticeWriter } from '../src/modules/subscription/sync/notice-writer.js';

const FETCHED_AT = new Date('2026-11-09T00:00:00Z');

/** happy-corrected(정정본, 정정 표시 1)의 원 공고 — 정정 표시를 떼고 공고번호를 앞 번호로 */
const ORIGINAL: [string, string][] = [
  ['[정정공고]서울번동3', '서울번동3'],
  ['2015122300020605', '2015122300020577'],
];

/** LH 실제 응답(test/fixtures/lh)을 원문 일부만 바꿔 정규화한다 — 저장 테스트의 입력은 늘 정규화 결과다 */
const fixtureOf = (name: string, edits: [string, string][] = []) => {
  const text = edits.reduce((current, [from, to]) => {
    if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
    return current.replaceAll(from, to);
  }, readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'lh', `${name}.json`), 'utf8'));
  const raw: unknown = JSON.parse(text);
  const result = normalizeLhNotice(lhBundleOf(raw));
  if (result.kind !== 'notice') throw new Error(`${name}이 공고가 아니라 ${result.kind}로 정규화됐습니다`);
  return { notice: result.notice, raw };
};

describe('정규화한 공고 저장 (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  const writer = new NoticeWriter(prisma);
  const write = ({ notice, raw }: { notice: NormalizedNotice; raw: unknown }) => writer.write(notice, raw, FETCHED_AT);

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

  it('처음 받은 공고: 공고·우선 원천·단지(주소)·별칭·칸·일정·주택형을 만든다', async () => {
    const result = await write(fixtureOf('national-corrected-suffix'));
    expect(result).toMatchObject({ createdNotice: true, primary: true, warnings: [] });

    const notice = await prisma.notice.findUniqueOrThrow({ where: { id: result.noticeId }, include: { sources: true } });
    expect(notice).toMatchObject({
      agencyCode: 1,
      title: '[정정공고]도봉주공1단지 국민임대주택 예비입주자 모집 공고(정정공고)',
      titleKey: '도봉주공1단지 국민임대주택 예비입주자 모집 공고',
      supplyCategory: 'PUBLIC_RENTAL',
      origin: 'SYNC',
      syncedAt: FETCHED_AT,
    });
    expect(notice.sources).toEqual([
      expect.objectContaining({ source: 'LH', sourceKey: '03:2015122300018941', isPrimary: true, fetchedAt: FETCHED_AT }),
    ]);

    const [subscription] = await prisma.subscription.findMany({
      where: { noticeId: result.noticeId },
      include: { complex: { include: { aliases: true } }, schedules: { orderBy: { sortOrder: 'asc' } }, units: true },
    });
    expect(subscription).toMatchObject({
      complexMatch: 'ADDRESS',
      regionCode: 1,
      applyStartDate: new Date('2025-09-16T00:00:00Z'),
      applyEndDate: new Date('2025-09-17T00:00:00Z'),
      supplyUnits: 41,
    });
    expect(subscription.complex).toMatchObject({
      name: '서울도봉',
      addressKey: '서울특별시 도봉구 도봉로180길 83-14',
      geocodeStatus: null,
      households: 245,
    });
    expect(subscription.complex?.aliases).toEqual([
      expect.objectContaining({ source: 'LH', sigungu: '도봉구', nameKey: '서울도봉', method: 'ADDRESS' }),
    ]);
    expect(subscription.schedules[0]).toMatchObject({
      kind: 'APPLY',
      startTime: new Date('1970-01-01T10:00:00Z'),
      endTime: null,
    });
    expect(subscription.units.map((unit) => unit.label).sort()).toEqual(['36형', '45형']);
  });

  it('같은 공고를 다시 받아도 행이 늘지 않고 칸 id가 그대로다', async () => {
    const first = await write(fixtureOf('permanent-multi-complex'));
    const second = await write(fixtureOf('permanent-multi-complex'));
    expect(second).toMatchObject({ noticeId: first.noticeId, createdNotice: false, primary: true });
    expect(second.subscriptionIds).toEqual(first.subscriptionIds);
    expect(await prisma.complex.count()).toBe(7);
    expect(await prisma.complexAlias.count()).toBe(7);
    expect(await prisma.subscriptionSchedule.count()).toBe(14);
  });

  describe('정정공고(ERD §5 규칙 7)', () => {
    it('원 공고 뒤에 정정본이 오면 같은 공고에 원천을 더하고, 정정본이 값을 정하며 칸 id는 그대로다', async () => {
      const original = await write(fixtureOf('happy-corrected', ORIGINAL));
      const corrected = await write(fixtureOf('happy-corrected'));
      expect(corrected).toMatchObject({ noticeId: original.noticeId, createdNotice: false, primary: true });
      expect(corrected.subscriptionIds).toEqual(original.subscriptionIds);
      const sources = await prisma.noticeSource.findMany({ orderBy: { sourceKey: 'asc' } });
      expect(sources.map((source) => [source.sourceKey, source.isPrimary])).toEqual([
        ['03:2015122300020577', false],
        ['03:2015122300020605', true],
      ]);
      expect((await prisma.notice.findUniqueOrThrow({ where: { id: original.noticeId } })).title).toBe(
        '[정정공고]서울번동3 행복주택 예비입주자 모집',
      );
    });

    it('정정본 뒤에 원 공고가 오면 원천 참조만 더하고 값은 정정본 그대로다', async () => {
      const corrected = await write(fixtureOf('happy-corrected'));
      const lateOriginal = await write(fixtureOf('happy-corrected', ORIGINAL));
      expect(lateOriginal).toMatchObject({ noticeId: corrected.noticeId, primary: false, subscriptionIds: [] });
      const notice = await prisma.notice.findUniqueOrThrow({ where: { id: corrected.noticeId } });
      expect(notice.title).toBe('[정정공고]서울번동3 행복주택 예비입주자 모집');
      expect(await prisma.noticeSource.count({ where: { isPrimary: true } })).toBe(1);
    });

    it('늦게 온 원 공고는 칸·주택형·일정을 바꾸지 않는다', async () => {
      const corrected = await write(fixtureOf('happy-corrected'));
      const before = await prisma.subscription.findMany({ include: { units: true, schedules: true } });
      await write(fixtureOf('happy-corrected', [...ORIGINAL, ['"NOW_HSH_CNT": "25"', '"NOW_HSH_CNT": "99"']]));
      const after = await prisma.subscription.findMany({ include: { units: true, schedules: true } });
      expect(after).toEqual(before);
      expect(after[0].noticeId).toBe(corrected.noticeId);
    });

    it('같은 날 같은 이름이어도 같은 정정 단계가 이미 있으면 다른 공고다 — 한쪽이 다른 쪽 칸을 지우지 않는다', async () => {
      const first = await write(fixtureOf('permanent-multi-complex'));
      const other = await write(
        fixtureOf('permanent-multi-complex', [
          ['2015122300019045', '2015122300019999'],
          ['서울특별시 강남구 자곡로3길 22', '서울특별시 강남구 다른로 1'],
        ]),
      );
      expect(other).toMatchObject({ createdNotice: true, primary: true });
      expect(other.noticeId).not.toBe(first.noticeId);
      // 주소만 바꾼 같은 이름 단지라 별칭 충돌 경고도 함께 난다
      expect(other.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'SAME_TITLE_NOT_CORRECTION' })]),
      );
      expect(await prisma.subscription.count({ where: { noticeId: first.noticeId } })).toBe(7);
    });

    it('원 공고·정정본으로 묶인 뒤 정정 표시 없는 다른 공고가 오면 묶지 않는다', async () => {
      const original = await write(fixtureOf('happy-corrected', ORIGINAL));
      await write(fixtureOf('happy-corrected'));
      const other = await write(fixtureOf('happy-corrected', [...ORIGINAL, ['2015122300020577', '2015122300020599']]));
      expect(other.noticeId).not.toBe(original.noticeId);
      expect(other.warnings).toEqual([expect.objectContaining({ code: 'SAME_TITLE_NOT_CORRECTION' })]);
    });

    it('묶음 후보가 둘 이상이면 어느 쪽인지 몰라 새 공고로 둔다', async () => {
      const input = fixtureOf('national-corrected-suffix');
      const { titleKey, postDate } = input.notice;
      for (const id of ['twin-a', 'twin-b']) {
        await prisma.notice.create({
          data: {
            id,
            agencyCode: 1,
            title: titleKey,
            titleKey,
            supplyCategory: 'PUBLIC_RENTAL',
            postDate: new Date(`${postDate}T00:00:00Z`),
            origin: 'SYNC',
          },
        });
      }
      const result = await write(input);
      expect(result.createdNotice).toBe(true);
      expect(result.warnings).toEqual([expect.objectContaining({ code: 'CORRECTION_AMBIGUOUS' })]);
    });

    it('게시일이 없는 공고는 이름만으로 묶지 않고, 같은 원천 키로만 다시 찾는다', async () => {
      const input = fixtureOf('national-corrected-suffix');
      const undated = { ...input, notice: { ...input.notice, postDate: null } };
      const first = await write(undated);
      expect((await write(undated)).noticeId).toBe(first.noticeId);
      const otherSource = { ...undated, notice: { ...undated.notice, sourceKey: '03:OTHER' } };
      expect((await write(otherSource)).noticeId).not.toBe(first.noticeId);
    });
  });

  describe('원천 순위(ERD §5 규칙 12)', () => {
    const applyhomeOf = (input: ReturnType<typeof fixtureOf>) => ({
      ...input,
      notice: {
        ...input.notice,
        source: 'APPLYHOME' as const,
        sourceKey: 'H2026000001:1',
        correctionMarks: 0,
        supplyType: '청약홈 유형',
      },
    });

    it('청약홈이 먼저 정한 공고도 기관 원천(LH)이 오면 LH가 값을 정하고, 그 뒤 청약홈은 참조만 더한다', async () => {
      const lh = fixtureOf('happy-corrected');
      const applyhome = await write(applyhomeOf(lh));
      expect((await prisma.notice.findUniqueOrThrow({ where: { id: applyhome.noticeId } })).supplyType).toBe('청약홈 유형');
      const agency = await write(lh);
      expect(agency).toMatchObject({ noticeId: applyhome.noticeId, primary: true });
      expect((await prisma.notice.findUniqueOrThrow({ where: { id: applyhome.noticeId } })).supplyType).toBe('행복주택');
      expect(await write(applyhomeOf(lh))).toMatchObject({ noticeId: applyhome.noticeId, primary: false });
      expect((await prisma.noticeSource.findFirstOrThrow({ where: { isPrimary: true } })).source).toBe('LH');
    });
  });

  describe('동시에 저장할 때', () => {
    it('두 공고가 같은 새 단지를 동시에 만들어도 둘 다 저장되고 단지는 하나다', async () => {
      const results = await Promise.allSettled([
        write(fixtureOf('national-corrected-suffix')),
        write(
          fixtureOf('national-corrected-suffix', [
            ['2015122300018941', '2015122300018999'],
            ['도봉주공1단지 국민임대주택', '도봉주공1단지 국민임대주택 2차'],
          ]),
        ),
      ]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await prisma.notice.count()).toBe(2);
      expect(await prisma.complex.count()).toBe(1);
    });
  });

  describe('저장 직전 확인', () => {
    it('JSON으로 담을 수 없는 원천 응답은 던지지 않고 거부한다(반복 처리가 통째로 멈추지 않게)', async () => {
      const { notice } = fixtureOf('sale');
      await expect(writer.write(notice, { value: 1n }, FETCHED_AT)).rejects.toThrow(/JSON/);
    });
  });

  describe('정정 묶음의 차수', () => {
    it('이름이 같아도 게시일이 다르면 다른 차수다', async () => {
      const thisYear = await write(fixtureOf('happy-corrected'));
      const lastYear = await write(
        fixtureOf('happy-corrected', [...ORIGINAL, ['"PAN_DT": "20260819"', '"PAN_DT": "20250822"']]),
      );
      expect(lastYear.noticeId).not.toBe(thisYear.noticeId);
    });
  });

  describe('단지 판별(ERD §5 규칙 8)', () => {
    it('주소 없는 건물 이름은 이름 별칭(NAME)으로 단지를 만들고, 다시 받으면 같은 단지를 찾는다', async () => {
      await write(fixtureOf('purchase-youth-building-names'));
      await write(fixtureOf('purchase-youth-building-names'));
      expect(await prisma.complex.count()).toBe(4);
      const subscriptions = await prisma.subscription.findMany({ include: { complex: true } });
      expect(subscriptions.map((row) => row.complexMatch)).toEqual(['NAME', 'NAME', 'NAME', 'NAME']);
      expect(subscriptions[0].complex).toMatchObject({ address: null, geocodeStatus: 'NO_ADDRESS' });
      expect(await prisma.complexAlias.count({ where: { sigungu: '', method: 'NAME' } })).toBe(4);
    });

    it('시드처럼 확인된 별칭(MANUAL)이 있으면 그 단지에 잇고 평면도를 보일 연결(MANUAL)로 둔다', async () => {
      await prisma.complex.create({
        data: {
          id: 'seed-yeonji',
          agencyCode: 1,
          regionCode: 1,
          name: '종로연지동(대보213)',
          address: '서울특별시 종로구 어느길 1',
          aliases: {
            create: { source: 'LH', agencyCode: 1, regionCode: 1, sigungu: '', nameKey: '종로연지동(대보213)', method: 'MANUAL' },
          },
        },
      });
      await write(fixtureOf('purchase-youth-building-names'));
      const linked = await prisma.subscription.findFirstOrThrow({ where: { complexId: 'seed-yeonji' } });
      expect(linked.complexMatch).toBe('MANUAL');
      expect((await prisma.complexAlias.findFirstOrThrow({ where: { complexId: 'seed-yeonji' } })).method).toBe('MANUAL');
      expect(await prisma.complex.count()).toBe(4);
      // 이미 있는 단지의 값은 채우기만 하고 덮어쓰지 않는다
      expect((await prisma.complex.findUniqueOrThrow({ where: { id: 'seed-yeonji' } })).address).toBe(
        '서울특별시 종로구 어느길 1',
      );
    });

    it('주소가 같은 기존 단지가 있으면 새로 만들지 않고 잇고, 이미 있는 값은 덮어쓰지 않고 빈 값만 채운다', async () => {
      await prisma.complex.create({
        data: {
          id: 'existing-dobong',
          agencyCode: 1,
          regionCode: 1,
          name: '도봉주공1단지',
          addressKey: '서울특별시 도봉구 도봉로180길 83-14',
          households: 100,
          imageUrl: '/keep.png',
        },
      });
      await write(fixtureOf('national-corrected-suffix'));
      const subscription = await prisma.subscription.findFirstOrThrow();
      expect(subscription).toMatchObject({ complexId: 'existing-dobong', complexMatch: 'ADDRESS' });
      expect(await prisma.complex.count()).toBe(1);
      expect(await prisma.complex.findUniqueOrThrow({ where: { id: 'existing-dobong' } })).toMatchObject({
        name: '도봉주공1단지',
        households: 100,
        imageUrl: '/keep.png',
        sigungu: '도봉구',
      });
      expect(Number((await prisma.complex.findUniqueOrThrow({ where: { id: 'existing-dobong' } })).areaMin)).toBe(36.44);
    });

    it('같은 이름의 별칭이 다른 단지를 가리키면 주소로 판별한 단지를 쓰고 별칭은 그대로 둔다', async () => {
      await prisma.complex.create({
        data: {
          id: 'other-named',
          agencyCode: 1,
          regionCode: 1,
          name: '다른 서울도봉',
          aliases: {
            create: { source: 'LH', agencyCode: 1, regionCode: 1, sigungu: '도봉구', nameKey: '서울도봉', method: 'MANUAL' },
          },
        },
      });
      const result = await write(fixtureOf('national-corrected-suffix'));
      const subscription = await prisma.subscription.findFirstOrThrow();
      expect(subscription.complexId).not.toBe('other-named');
      expect(subscription.complexMatch).toBe('ADDRESS');
      expect(result.warnings).toEqual([expect.objectContaining({ code: 'ALIAS_ADDRESS_CONFLICT' })]);
      expect((await prisma.complexAlias.findFirstOrThrow({ where: { nameKey: '서울도봉' } })).complexId).toBe('other-named');
    });

    it('판별 키를 못 만든 호별 주소는 주소 원문으로 다시 찾고, 지어낸 이름으로 별칭을 만들지 않는다', async () => {
      const blockAddress = fixtureOf('purchase-per-unit-address', [['소사로148번길 58-9(소사본동)', '괴안지구 A1블록(소사본동)']]);
      expect(blockAddress.notice.listings[0].complex?.addressKey).toBeNull();
      await write(blockAddress);
      await write(blockAddress);
      expect(await prisma.complex.count()).toBe(4);
      expect(await prisma.complexAlias.count()).toBe(0);
    });

    it('호별 주소가 다른 같은 이름 건물은 다른 단지다', async () => {
      await write(fixtureOf('purchase-per-unit-address'));
      const names = (await prisma.complex.findMany({ orderBy: { addressKey: 'asc' } })).map((row) => row.name);
      expect(names.filter((name) => name === '나눔주택')).toHaveLength(2);
      expect(await prisma.complexAlias.count()).toBe(0);
    });

    it('한 공고의 두 칸이 같은 단지로 판별되면 한 칸으로 합친다', async () => {
      await prisma.complex.create({
        data: {
          id: 'one-building',
          agencyCode: 1,
          regionCode: 1,
          name: '종로 같은 건물',
          aliases: {
            create: [
              { source: 'LH', agencyCode: 1, regionCode: 1, sigungu: '', nameKey: '종로연지동(대보213)', method: 'MANUAL' },
              { source: 'LH', agencyCode: 1, regionCode: 1, sigungu: '', nameKey: '종로숭인동(시티플러스)', method: 'MANUAL' },
            ],
          },
        },
      });
      const result = await write(fixtureOf('purchase-youth-building-names'));
      const merged = await prisma.subscription.findFirstOrThrow({ where: { complexId: 'one-building' } });
      expect(merged).toMatchObject({ supplyUnits: 3, recruitCount: 9 });
      expect(await prisma.subscription.count()).toBe(3);
      expect(result.warnings).toEqual([expect.objectContaining({ code: 'LISTINGS_MERGED' })]);
      expect(await prisma.subscriptionSchedule.count({ where: { subscriptionId: merged.id } })).toBe(4);
    });
  });

  describe('다시 받을 때(ERD §5 규칙 13)', () => {
    it('원천에서 사라진 단지의 칸은 지우고 나머지 칸 id는 그대로 둔다', async () => {
      const first = await write(fixtureOf('permanent-multi-complex'));
      const second = await write(
        fixtureOf('permanent-multi-complex', [['서울특별시 강서구 화곡로63가길 92', '충청남도 천안시 화곡로63가길 92']]),
      );
      expect(second.subscriptionIds).toEqual(first.subscriptionIds.slice(0, 6));
      expect(await prisma.subscription.count()).toBe(6);
    });

    it('청약홈이 채운 신청 인원(칸·주택형)은 LH를 다시 받아도 남는다', async () => {
      const first = await write(fixtureOf('happy-corrected'));
      const [subscriptionId] = first.subscriptionIds;
      await prisma.subscription.update({ where: { id: subscriptionId }, data: { applicationCount: 120 } });
      await prisma.subscriptionUnit.updateMany({ where: { subscriptionId, label: '16A' }, data: { applicationCount: 40 } });
      const unitIdsBefore = (
        await prisma.subscriptionUnit.findMany({ where: { subscriptionId }, orderBy: { displayOrder: 'asc' } })
      ).map((unit) => unit.id);
      await write(fixtureOf('happy-corrected'));
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } })).applicationCount).toBe(120);
      const units = await prisma.subscriptionUnit.findMany({ where: { subscriptionId }, orderBy: { displayOrder: 'asc' } });
      expect(units.map((unit) => unit.id)).toEqual(unitIdsBefore);
      expect(units.map((unit) => [unit.label, unit.applicationCount])).toEqual([
        ['16A', 40],
        ['21A', null],
        ['44A', null],
      ]);
    });

    it('단지 정보가 없는 공고는 공고 단위 칸 하나를 유지한다', async () => {
      const first = await write(fixtureOf('purchase-no-supply'));
      const second = await write(fixtureOf('purchase-no-supply'));
      expect(second.subscriptionIds).toEqual(first.subscriptionIds);
      expect(await prisma.subscription.findMany()).toEqual([
        expect.objectContaining({ complexId: null, complexMatch: null, regionCode: 3 }),
      ]);
    });

    it('넷째 자리 반올림이 갈리는 면적(16.12345)도 다시 받을 때 같은 주택형으로 본다', async () => {
      const input = fixtureOf('happy-corrected', [['"DDO_AR": "16.99"', '"DDO_AR": "16.12345"']]);
      const [subscriptionId] = (await write(input)).subscriptionIds;
      await prisma.subscriptionUnit.updateMany({ where: { subscriptionId, label: '16A' }, data: { applicationCount: 7 } });
      const before = await prisma.subscriptionUnit.findFirstOrThrow({ where: { subscriptionId, label: '16A' } });
      await write(input);
      expect(await prisma.subscriptionUnit.findFirstOrThrow({ where: { subscriptionId, label: '16A' } })).toMatchObject({
        id: before.id,
        applicationCount: 7,
      });
    });
  });

  describe('정정 단계는 원천마다 따로 센다', () => {
    const SECOND_CORRECTION: [string, string][] = [
      ['[정정공고]서울번동3', '[정정공고][정정공고]서울번동3'],
      ['2015122300020605', '2015122300020610'],
    ];

    it('원 공고 → 정정 → 2차 정정 → 정정 재수신이어도 한 공고이고 2차 정정이 값을 정한다', async () => {
      const original = await write(fixtureOf('happy-corrected', ORIGINAL));
      await write(fixtureOf('happy-corrected'));
      await write(fixtureOf('happy-corrected', SECOND_CORRECTION));
      const resent = await write(fixtureOf('happy-corrected'));
      expect(resent).toMatchObject({ noticeId: original.noticeId, primary: false });
      expect(await prisma.notice.count()).toBe(1);
      expect((await prisma.noticeSource.findFirstOrThrow({ where: { isPrimary: true } })).sourceKey).toBe(
        '03:2015122300020610',
      );
    });

    it('LH 원 공고(정정 표시 0)에 청약홈 공고(정정 표시 0)가 와도 원천이 달라 같은 공고로 묶고 LH가 값을 정한다', async () => {
      const lh = await write(fixtureOf('happy-corrected', ORIGINAL));
      const input = fixtureOf('happy-corrected', ORIGINAL);
      const applyhome = await write({
        ...input,
        notice: { ...input.notice, source: 'APPLYHOME', sourceKey: 'H2026000001:1', correctionMarks: 0 },
      });
      expect(applyhome).toMatchObject({ noticeId: lh.noticeId, primary: false });
    });

    it('관리자가 등록한 공고는 이름·게시일이 같아도 묶음 후보가 아니다', async () => {
      const input = fixtureOf('national-corrected-suffix');
      await prisma.notice.create({
        data: {
          id: 'manual-notice',
          agencyCode: 1,
          title: input.notice.title,
          titleKey: input.notice.titleKey,
          supplyCategory: 'PUBLIC_RENTAL',
          postDate: new Date(`${input.notice.postDate}T00:00:00Z`),
          origin: 'MANUAL',
        },
      });
      const result = await write(input);
      expect(result.noticeId).not.toBe('manual-notice');
      expect(result.createdNotice).toBe(true);
    });
  });

  it('판별 키를 못 만든 주소는 주소 원문이 같은 단지라면 판별 키가 있어도 다시 찾는다', async () => {
    const blockAddress = fixtureOf('purchase-per-unit-address', [['소사로148번길 58-9(소사본동)', '괴안지구 A1블록(소사본동)']]);
    const address = blockAddress.notice.listings[0].complex?.address;
    await prisma.complex.create({
      data: { id: 'keyed-by-admin', agencyCode: 1, regionCode: 3, name: '한결주택', address, addressKey: '관리자가 정한 키' },
    });
    await write(blockAddress);
    expect((await prisma.subscription.findFirstOrThrow({ where: { complexId: 'keyed-by-admin' } })).complexMatch).toBe(
      'ADDRESS',
    );
  });
});
