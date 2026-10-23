import { jest } from '@jest/globals';
import { AgencyCode, RegionCode, SubscriptionStatusCode } from '@/common/constants/interface-codes.js';
import type { Clock } from '@/common/time/clock.js';
import { Prisma } from '@/database/generated/client.js';
import { AppException } from '@/common/errors/app.exception.js';
import { SIZE_RANGES } from './constants.js';
import { SearchQuery } from './dto/search.request.js';
import { SubscriptionListQuery, SubscriptionMapQuery } from './dto/subscription-filter.request.js';
import type {
  SubscriptionListFilter,
  SubscriptionListRecord,
  SubscriptionMarkerRow,
  SubscriptionRepository,
  SubscriptionSearchRow,
} from './subscription.repository.js';
import { SubscriptionService } from './subscription.service.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// 한국 9월 8일 — open은 접수 중(마감 D-3), upcoming은 접수 전, closed는 마감 뒤다
const TODAY = '2026-09-08';
const SCHEDULES = {
  open: { applyStartDate: day('2026-09-07'), applyEndDate: day('2026-09-11') },
  upcoming: { applyStartDate: day('2026-09-20'), applyEndDate: day('2026-09-25') },
  closed: { applyStartDate: day('2026-08-01'), applyEndDate: day('2026-08-05') },
} as const;
type FixtureId = keyof typeof SCHEDULES;
const isFixtureId = (id: string): id is FixtureId => id in SCHEDULES;

const listRecord = (id: FixtureId): SubscriptionListRecord => ({
  id,
  title: `공고 ${id}`,
  agencyCode: AgencyCode.LH,
  regionCode: RegionCode.SEOUL,
  address: '서울',
  lat: 37.5,
  lng: 127,
  supplyType: null,
  households: null,
  supplyUnits: null,
  recruitCount: null,
  applicationCount: null,
  postDate: null,
  ...SCHEDULES[id],
  contractDate: null,
  moveInMonth: null,
  applyUrl: null,
  imageUrl: null,
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  floorplans: [{ exclusiveArea: new Prisma.Decimal(31.99) }, { exclusiveArea: new Prisma.Decimal(28.81) }],
});

const serviceWith = (page: { ids: string[]; totalCount: number } = { ids: [], totalCount: 0 }) => {
  const repository = {
    findPage: jest.fn<SubscriptionRepository['findPage']>().mockResolvedValue(page),
    // DB는 id 목록 순서를 지키지 않는다 — 뒤집어 돌려줘도 정렬 순서가 유지되는지 본다
    findListedByIds: jest
      .fn<(ids: string[], filter: SubscriptionListFilter) => Promise<SubscriptionListRecord[]>>()
      .mockImplementation((ids) => Promise.resolve([...ids].reverse().filter(isFixtureId).map(listRecord))),
    findSearchRows: jest
      .fn<(filter: SubscriptionListFilter) => Promise<SubscriptionSearchRow[]>>()
      .mockResolvedValue([]),
    findMarkerRows: jest.fn<(filter: SubscriptionListFilter) => Promise<SubscriptionMarkerRow[]>>(),
    findFilterOptionSources: jest.fn<SubscriptionRepository['findFilterOptionSources']>(),
  };
  const clock: Clock = { now: () => new Date(`${TODAY}T03:00:00Z`) };
  return { repository, service: new SubscriptionService(repository as unknown as SubscriptionRepository, clock) };
};

const listQuery = (values: Partial<SubscriptionListQuery> = {}) => Object.assign(new SubscriptionListQuery(), values);
const PAGE = { ids: ['open', 'closed', 'upcoming'], totalCount: 3 };

describe('청약 공고 목록(API-010)', () => {
  it('정렬·페이지는 DB에 맡기고, DB가 정한 id 순서대로 공고를 다시 읽어 그 순서를 지킨다', async () => {
    const { service, repository } = serviceWith(PAGE);
    const result = await service.list(listQuery({ sort: 'COMPETITION', page: 2, pageSize: 3 }));
    expect(repository.findPage).toHaveBeenCalledWith(expect.any(Object), {
      sort: 'COMPETITION',
      today: TODAY,
      offset: 3,
      limit: 3,
    });
    // 다시 읽을 때도 같은 조건을 건다 — 사이에 조건에서 벗어난 공고가 섞이지 않게
    expect(repository.findListedByIds).toHaveBeenCalledWith(PAGE.ids, repository.findPage.mock.calls[0][0]);
    expect(result.items.map((item) => [item.id, item.dday, item.statusCode])).toEqual([
      ['open', 3, SubscriptionStatusCode.OPEN],
      ['closed', null, SubscriptionStatusCode.CLOSED],
      ['upcoming', null, SubscriptionStatusCode.UPCOMING],
    ]);
    expect(result).toMatchObject({ page: 2, pageSize: 3, totalCount: 3 });
    expect(result.items[0].sizes).toEqual([28.81, 31.99]);
  });

  it('범위를 넘은 페이지는 다시 읽지 않고 전체 건수만 준다', async () => {
    const { service, repository } = serviceWith({ ids: [], totalCount: 3 });
    const beyond = await service.list(listQuery({ page: 9, pageSize: 1 }));
    expect(beyond).toMatchObject({ items: [], totalCount: 3 });
    expect(repository.findListedByIds).not.toHaveBeenCalled();
  });

  it('두 번 읽는 사이에 사라진 공고는 건너뛴다', async () => {
    const { service, repository } = serviceWith(PAGE);
    repository.findListedByIds.mockResolvedValueOnce([listRecord('open')]);
    const result = await service.list(listQuery());
    expect(result.items.map((item) => item.id)).toEqual(['open']);
    expect(result.totalCount).toBe(3);
  });

  it("상태는 오늘 날짜와 함께 DB 조건으로 넘기고, '전체'(0)는 조건을 걸지 않는다", async () => {
    const { service, repository } = serviceWith();
    await service.list(
      listQuery({
        status: SubscriptionStatusCode.OPEN,
        region: RegionCode.ALL,
        agency: AgencyCode.LH,
        size: '20-25',
        keyword: '  LH ',
      }),
    );
    expect(repository.findPage).toHaveBeenCalledWith(
      {
        regionCode: undefined,
        agencyCode: AgencyCode.LH,
        sizeRange: { value: '20-25', min: 20, max: 25 },
        keyword: { text: 'lh', agencyCodes: [AgencyCode.LH], regionCodes: [] },
        bounds: undefined,
        status: { code: SubscriptionStatusCode.OPEN, today: TODAY },
      },
      expect.objectContaining({ sort: 'DEADLINE', offset: 0, limit: 20 }),
    );
    await service.list(listQuery({ status: SubscriptionStatusCode.ALL }));
    expect(repository.findPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: undefined }),
      expect.anything(),
    );
  });
});

describe('통합 검색(API-095)', () => {
  const searchRow = (id: FixtureId, title: string): SubscriptionSearchRow => ({
    id,
    title,
    ...SCHEDULES[id],
    cancelledAt: null,
  });
  const searchQuery = (values: Partial<SearchQuery>) => Object.assign(new SearchQuery(), values);

  it('정규화한 검색어로 목록과 같은 조건을 걸고, 순위를 매긴 뒤에 페이지를 나눈다', async () => {
    const { service, repository } = serviceWith();
    repository.findSearchRows.mockResolvedValue([
      searchRow('closed', '행복주택 2차'),
      searchRow('open', '서울 공고'),
      searchRow('upcoming', '행복주택'),
    ]);
    const first = await service.search(searchQuery({ q: '  행복주택 ', pageSize: 2 }));
    expect(repository.findSearchRows).toHaveBeenCalledWith({
      keyword: { text: '행복주택', agencyCodes: [], regionCodes: [] },
    });
    expect(repository.findListedByIds).toHaveBeenCalledWith(
      ['upcoming', 'closed'],
      repository.findSearchRows.mock.calls[0][0],
    );
    expect(first).toMatchObject({ page: 1, pageSize: 2, products: { items: [], totalCount: 0 } });
    expect(first.subscriptions.items.map((item) => item.id)).toEqual(['upcoming', 'closed']);
    expect(first.subscriptions.totalCount).toBe(3);
    const second = await service.search(searchQuery({ q: '행복주택', page: 2, pageSize: 2 }));
    expect(second.subscriptions.items.map((item) => item.id)).toEqual(['open']);
    expect(second.subscriptions.totalCount).toBe(3);
  });

  it('맞는 공고가 없으면 다시 읽지 않는다', async () => {
    const { service, repository } = serviceWith();
    const result = await service.search(searchQuery({ q: '없는 공고' }));
    expect(result.subscriptions).toEqual({ items: [], totalCount: 0 });
    expect(repository.findListedByIds).not.toHaveBeenCalled();
  });

  it('공백뿐인 검색어는 검증 오류다', async () => {
    const { service, repository } = serviceWith();
    await expect(service.search(searchQuery({ q: '   ' }))).rejects.toEqual(new AppException('VALIDATION_ERROR'));
    expect(repository.findSearchRows).not.toHaveBeenCalled();
  });
});

describe('지도 핀(API-012)', () => {
  it('핀마다 상태·D-day를 붙이고, 좌표가 없는 행은 빼며, 영역은 남·서·북·동으로 풀어 넘긴다', async () => {
    const { service, repository } = serviceWith();
    const marker = (id: FixtureId, lat: number | null): SubscriptionMarkerRow => ({
      id,
      title: `공고 ${id}`,
      lat,
      lng: lat === null ? null : 127,
      agencyCode: AgencyCode.SH,
      ...SCHEDULES[id],
      cancelledAt: null,
    });
    repository.findMarkerRows.mockResolvedValue([marker('open', 37.5), marker('closed', null)]);
    const result = await service.mapMarkers(
      Object.assign(new SubscriptionMapQuery(), { bounds: '37.4,126.8,37.7,127.2' }),
    );
    expect(result.markers).toEqual([
      {
        id: 'open',
        title: '공고 open',
        lat: 37.5,
        lng: 127,
        dday: 3,
        agencyCode: AgencyCode.SH,
        statusCode: SubscriptionStatusCode.OPEN,
      },
    ]);
    expect(repository.findMarkerRows).toHaveBeenCalledWith(
      expect.objectContaining({ bounds: { south: 37.4, west: 126.8, north: 37.7, east: 127.2 } }),
    );
  });
});

describe('필터 선택지', () => {
  it('DB가 확인한 지역·기관·상태·면적 구간을 응답 모양으로 바꾼다 — 상태는 오늘 날짜로 묻는다', async () => {
    const { service, repository } = serviceWith();
    repository.findFilterOptionSources.mockResolvedValue({
      regionCodes: [RegionCode.GYEONGGI, RegionCode.SEOUL],
      agencyCodes: [AgencyCode.LH],
      statusCodes: [SubscriptionStatusCode.OPEN, SubscriptionStatusCode.CLOSED],
      sizeRanges: [SIZE_RANGES[0], SIZE_RANGES[4]],
    });
    await expect(service.filterOptions()).resolves.toEqual({
      regions: [RegionCode.SEOUL, RegionCode.GYEONGGI],
      agencies: [AgencyCode.LH],
      statuses: [SubscriptionStatusCode.OPEN, SubscriptionStatusCode.CLOSED],
      sizeRanges: [
        { value: '0-15', min: 0, max: 15 },
        { value: '30-', min: 30, max: null },
      ],
    });
    expect(repository.findFilterOptionSources).toHaveBeenCalledWith(TODAY);
  });
});
