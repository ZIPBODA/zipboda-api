import { jest } from '@jest/globals';
import { AppException } from '@/common/errors/app.exception.js';
import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import type { Clock } from '@/common/time/clock.js';
import { Prisma } from '@/database/generated/client.js';
import type { FloorplanRecord, SubscriptionDetailRecord, SubscriptionRepository } from './subscription.repository.js';
import { SubscriptionService } from './subscription.service.js';

type DetailComplex = NonNullable<SubscriptionDetailRecord['complex']>;
type DetailUnit = SubscriptionDetailRecord['units'][number];
type DetailFloorplan = DetailComplex['floorplans'][number];

const complex = (overrides: Partial<DetailComplex> = {}): DetailComplex => ({
  name: '강남개포동',
  sigungu: '강남구',
  address: '서울 강남구 논현로12길 23-5',
  lat: 37.47,
  lng: 127.04,
  households: 13,
  imageUrl: null,
  floorplans: [],
  ...overrides,
});

const record = (overrides: Partial<SubscriptionDetailRecord> = {}): SubscriptionDetailRecord => ({
  id: 'gangnam-gaepo-26-3',
  noticeId: 'notice-26-3',
  complexId: 'gangnam-gaepo',
  complexMatch: 'MANUAL',
  regionCode: 1,
  applyStartDate: new Date('2026-09-07T00:00:00Z'),
  applyEndDate: new Date('2026-09-11T00:00:00Z'),
  winnerDate: null,
  contractStartDate: new Date('2026-11-16T00:00:00Z'),
  contractEndDate: new Date('2026-11-20T00:00:00Z'),
  moveInMonth: '2026-11',
  supplyUnits: 3,
  recruitCount: 9,
  applicationCount: 691,
  supplyNote: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  notice: {
    title: '26년 3차 청년 매입임대주택 예비입주자 모집공고',
    agencyCode: 1,
    supplyType: '청년매입임대',
    postDate: new Date('2026-09-01T00:00:00Z'),
    applyUrl: 'https://apply.lh.or.kr',
    cancelledAt: null,
  },
  complex: complex(),
  units: [],
  ...overrides,
});

const unit = (overrides: Partial<DetailUnit>): DetailUnit => ({
  id: 'u',
  subscriptionId: 'gangnam-gaepo-26-3',
  label: null,
  sizeType: null,
  unitType: null,
  exclusiveArea: null,
  areaMin: null,
  areaMax: null,
  supplyArea: null,
  unitNumber: null,
  floorLabel: null,
  totalHouseholds: null,
  supplyHouseholds: null,
  recruitCount: null,
  applicationCount: null,
  depositWon: null,
  monthlyRentWon: null,
  salePriceWon: null,
  priceNote: null,
  note: null,
  displayOrder: 0,
  ...overrides,
});

const plan: DetailFloorplan = {
  id: 'p1',
  complexId: 'gangnam-gaepo',
  floor: '2-3',
  unitNumber: '01',
  unitType: null,
  exclusiveArea: null,
  sizeType: '28',
  image2dUrl: null,
  has3d: true,
  displayOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const serviceWith = (found: SubscriptionDetailRecord | null, now: string) => {
  const repository = { findDetailById: jest.fn<SubscriptionRepository['findDetailById']>().mockResolvedValue(found) };
  const clock: Clock = { now: () => new Date(now) };
  return { repository, service: new SubscriptionService(repository as unknown as SubscriptionRepository, clock) };
};

const NOW = '2026-09-08T03:00:00Z';

describe('청약 공고 상세', () => {
  it('없는 칸은 NOT_FOUND로 알린다', async () => {
    const { service } = serviceWith(null, NOW);
    await expect(service.getDetail('missing')).rejects.toEqual(new AppException('NOT_FOUND'));
  });

  it('한국 날짜 기준으로 상태를 계산하고, 이름은 단지명·공고명을 함께 주며 기관 이름·경쟁률을 채운다', async () => {
    // UTC 9월 11일 15:00 = 한국 9월 12일 0시 — 마감 다음 날이다
    const { service, repository } = serviceWith(record(), '2026-09-11T15:00:00Z');
    const detail = await service.getDetail('gangnam-gaepo-26-3');
    expect(repository.findDetailById).toHaveBeenCalledWith('gangnam-gaepo-26-3');
    expect(detail).toMatchObject({
      title: '강남개포동',
      noticeTitle: '26년 3차 청년 매입임대주택 예비입주자 모집공고',
      agencyCode: 1,
      agencyName: '한국토지주택공사',
      statusCode: SubscriptionStatusCode.CLOSED,
      postDate: '2026-09-01',
      applyStartDate: '2026-09-07',
      deadline: '2026-09-11',
      contractDate: '2026-11-16',
      supplyType: '청년매입임대',
      households: 13,
      competition: '230.3:1',
      moveIn: '2026-11',
    });
  });

  it('공고 취소는 일정과 상관없이 취소 상태다', async () => {
    const cancelled = record({ notice: { ...record().notice, cancelledAt: new Date('2026-09-02T00:00:00Z') } });
    const { service } = serviceWith(cancelled, NOW);
    await expect(service.getDetail('gangnam-gaepo-26-3')).resolves.toMatchObject({
      statusCode: SubscriptionStatusCode.CANCELLED,
      dday: null,
    });
  });

  it('도면은 2D 이미지 주소·여부와 3D 여부를 함께 알린다', async () => {
    const drawn = { ...plan, id: 'p2', image2dUrl: '/housing/gangnam-gaepo/p2.png' };
    const { service } = serviceWith(record({ complex: complex({ floorplans: [plan, drawn] }) }), NOW);
    const detail = await service.getDetail('gangnam-gaepo-26-3');
    expect(detail.floorplans).toEqual([
      {
        id: 'p1',
        size: '28',
        type: null,
        floor: '2-3',
        unitNumber: '01',
        exclusiveArea: null,
        image2dUrl: null,
        has2d: false,
        has3d: true,
      },
      expect.objectContaining({ id: 'p2', image2dUrl: '/housing/gangnam-gaepo/p2.png', has2d: true }),
    ]);
  });

  it('이름으로만 이은 단지의 도면은 다른 건물일 수 있어 주지 않는다', async () => {
    const { service } = serviceWith(record({ complexMatch: 'NAME', complex: complex({ floorplans: [plan] }) }), NOW);
    await expect(service.getDetail('gangnam-gaepo-26-3')).resolves.toMatchObject({ floorplans: [] });
  });

  it('단지 정보가 없는 공고 단위 칸은 공고명과 지역으로 보이고 좌표·도면이 없다', async () => {
    const { service } = serviceWith(record({ complexId: null, complexMatch: null, complex: null, regionCode: 3 }), NOW);
    await expect(service.getDetail('gangnam-gaepo-26-3')).resolves.toMatchObject({
      title: '26년 3차 청년 매입임대주택 예비입주자 모집공고',
      address: '경기',
      lat: null,
      lng: null,
      households: null,
      floorplans: [],
    });
  });

  it('주택형은 전용면적(구간이면 하한) → 타입 → 호수 순이고, 금액은 원 단위 값을 한 줄로 읽는다', async () => {
    const units = [
      unit({ id: 'big', label: '74.9500A', sizeType: '74', unitType: 'A', exclusiveArea: new Prisma.Decimal(74.95) }),
      unit({ id: 'none', label: '2형', priceNote: '공고문 참조', displayOrder: 3 }),
      unit({
        id: 'range',
        label: '70~80㎡',
        areaMin: new Prisma.Decimal(70),
        areaMax: new Prisma.Decimal(80),
        supplyHouseholds: 2,
        totalHouseholds: 10,
      }),
      unit({
        id: 'small-402',
        label: '59A',
        sizeType: '59',
        unitType: 'A',
        exclusiveArea: new Prisma.Decimal(59.98),
        unitNumber: '402',
        floorLabel: '4층',
        depositWon: 30_000_000n,
        monthlyRentWon: 150_000n,
      }),
      unit({
        id: 'small-1001',
        sizeType: '59',
        unitType: 'A',
        exclusiveArea: new Prisma.Decimal(59.98),
        unitNumber: '1001',
        totalHouseholds: 4,
      }),
      // 같은 면적에서 타입을 모르면 타입이 있는 주택형 뒤다
      unit({ id: 'small-untyped', sizeType: '59', exclusiveArea: new Prisma.Decimal(59.98), unitNumber: '101' }),
    ];
    const { service } = serviceWith(record({ units }), NOW);
    const detail = await service.getDetail('gangnam-gaepo-26-3');
    expect(detail.units).toEqual([
      {
        size: '59',
        type: 'A',
        label: '59A',
        floor: '4층',
        unitNumber: '402',
        exclusiveArea: 59.98,
        households: null,
        price: '보증금 3,000만 원 · 월 15만 원',
      },
      expect.objectContaining({ size: '59', type: 'A', unitNumber: '1001', exclusiveArea: 59.98, households: 4 }),
      expect.objectContaining({ size: '59', type: null, unitNumber: '101', exclusiveArea: 59.98 }),
      // 구간으로만 온 주택형은 전용면적이 없다
      expect.objectContaining({ size: null, label: '70~80㎡', exclusiveArea: null, households: 2 }),
      expect.objectContaining({ size: '74', label: '74.9500A', exclusiveArea: 74.95 }),
      expect.objectContaining({ size: null, label: '2형', exclusiveArea: null, price: '공고문 참조' }),
    ]);
  });

  it('정의서에 없는 기관 코드가 저장돼 있으면 응답을 지어내지 않고 실패한다', async () => {
    const { service } = serviceWith(record({ notice: { ...record().notice, agencyCode: 9 } }), NOW);
    await expect(service.getDetail('gangnam-gaepo-26-3')).rejects.toThrow(/공급기관 코드/);
  });
});

describe('평면도 상세(API-031)', () => {
  const floorplanServiceWith = (found: FloorplanRecord | null, subscriptionId: string | null) => {
    const repository = {
      findFloorplanById: jest.fn<SubscriptionRepository['findFloorplanById']>().mockResolvedValue(found),
      findFloorplanSubscriptionId: jest
        .fn<SubscriptionRepository['findFloorplanSubscriptionId']>()
        .mockResolvedValue(subscriptionId),
    };
    const clock: Clock = { now: () => new Date(NOW) };
    return { repository, service: new SubscriptionService(repository as unknown as SubscriptionRepository, clock) };
  };
  const stored: FloorplanRecord = {
    ...plan,
    exclusiveArea: new Prisma.Decimal(28.81),
    image2dUrl: '/housing/gangnam-gaepo/p1.png',
    complex: { name: '강남개포동(T&K개포)' },
  };

  it('도면과 단지 이름, 들어갈 칸을 준다 — 칸은 단지와 오늘(한국 날짜)로 고른다', async () => {
    const { service, repository } = floorplanServiceWith(stored, 'gangnam-gaepo-26-3');
    await expect(service.getFloorplan('p1')).resolves.toEqual({
      id: 'p1',
      size: '28',
      type: null,
      floor: '2-3',
      unitNumber: '01',
      exclusiveArea: 28.81,
      image2dUrl: '/housing/gangnam-gaepo/p1.png',
      has2d: true,
      has3d: true,
      complexName: '강남개포동(T&K개포)',
      subscriptionId: 'gangnam-gaepo-26-3',
    });
    expect(repository.findFloorplanSubscriptionId).toHaveBeenCalledWith('gangnam-gaepo', '2026-09-08');
  });

  it('보여 줄 칸이 없으면 subscriptionId가 null이다', async () => {
    const { service } = floorplanServiceWith(stored, null);
    await expect(service.getFloorplan('p1')).resolves.toMatchObject({ subscriptionId: null });
  });

  it('없는 도면은 NOT_FOUND로 알리고 칸을 고르지 않는다', async () => {
    const { service, repository } = floorplanServiceWith(null, null);
    await expect(service.getFloorplan('missing')).rejects.toEqual(new AppException('NOT_FOUND'));
    expect(repository.findFloorplanSubscriptionId).not.toHaveBeenCalled();
  });
});
