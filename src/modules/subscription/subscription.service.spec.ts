import { jest } from '@jest/globals';
import { AppException } from '@/common/errors/app.exception.js';
import { SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import type { Clock } from '@/common/time/clock.js';
import type { SubscriptionDetailRecord, SubscriptionRepository } from './subscription.repository.js';
import { SubscriptionService } from './subscription.service.js';

const record = (overrides: Partial<SubscriptionDetailRecord> = {}): SubscriptionDetailRecord => ({
  id: 'gangnam-gaepo',
  title: '강남개포동',
  agencyCode: 1,
  regionCode: 1,
  address: '서울 강남구',
  lat: 37.47,
  lng: 127.04,
  supplyType: '도시형생활주택',
  households: 13,
  supplyUnits: 3,
  recruitCount: 9,
  applicationCount: 691,
  postDate: new Date('2026-09-01T00:00:00Z'),
  applyStartDate: new Date('2026-09-07T00:00:00Z'),
  applyEndDate: new Date('2026-09-11T00:00:00Z'),
  contractDate: null,
  moveInMonth: '2026-11',
  applyUrl: 'https://apply.lh.or.kr',
  imageUrl: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  units: [],
  floorplans: [],
  ...overrides,
});

const serviceWith = (found: SubscriptionDetailRecord | null, now: string) => {
  const repository = { findDetailById: jest.fn<SubscriptionRepository['findDetailById']>().mockResolvedValue(found) };
  const clock: Clock = { now: () => new Date(now) };
  return { repository, service: new SubscriptionService(repository as unknown as SubscriptionRepository, clock) };
};

describe('청약 공고 상세', () => {
  it('없는 공고는 NOT_FOUND로 알린다', async () => {
    const { service } = serviceWith(null, '2026-09-08T03:00:00Z');
    await expect(service.getDetail('missing')).rejects.toEqual(new AppException('NOT_FOUND'));
  });

  it('한국 날짜 기준으로 상태를 계산하고 기관 이름·경쟁률을 채운다', async () => {
    // UTC 9월 11일 15:00 = 한국 9월 12일 0시 — 마감 다음 날이다
    const { service, repository } = serviceWith(record(), '2026-09-11T15:00:00Z');
    const detail = await service.getDetail('gangnam-gaepo');
    expect(repository.findDetailById).toHaveBeenCalledWith('gangnam-gaepo');
    expect(detail).toMatchObject({
      agencyCode: 1,
      agencyName: '한국토지주택공사',
      statusCode: SubscriptionStatusCode.CLOSED,
      postDate: '2026-09-01',
      applyStartDate: '2026-09-07',
      deadline: '2026-09-11',
      competition: '230.3:1',
      moveIn: '2026-11',
    });
  });

  it('도면은 2D 이미지 여부와 3D 여부를 함께 알린다', async () => {
    const plan = {
      id: 'p1',
      subscriptionId: 'gangnam-gaepo',
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
    const { service } = serviceWith(record({ floorplans: [plan] }), '2026-09-08T03:00:00Z');
    const detail = await service.getDetail('gangnam-gaepo');
    expect(detail.floorplans).toEqual([
      {
        id: 'p1',
        size: '28',
        type: null,
        floor: '2-3',
        unitNumber: '01',
        exclusiveArea: null,
        has2d: false,
        has3d: true,
      },
    ]);
  });

  it('정의서에 없는 기관 코드가 저장돼 있으면 응답을 지어내지 않고 실패한다', async () => {
    const { service } = serviceWith(record({ agencyCode: 9 }), '2026-09-08T03:00:00Z');
    await expect(service.getDetail('gangnam-gaepo')).rejects.toThrow(/공급기관 코드/);
  });
});
