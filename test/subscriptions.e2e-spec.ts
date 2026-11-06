import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Clock } from '../src/common/time/clock.js';
import type { Prisma } from '../src/database/generated/client.js';
import { PrismaService } from '../src/database/prisma.service.js';

// 한국 9월 8일 정오 — e2e-open의 접수 기간(9/7~9/11) 한가운데다
const FIXED_NOW = new Date('2026-09-08T03:00:00Z');
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

interface ListBody {
  data: { items: { id: string; sizes: number[]; statusCode: number | null }[]; totalCount: number };
}
interface MapBody {
  data: { markers: { id: string }[] };
}
interface ErrorBody {
  error: { code: string; message: string };
}
interface SearchBody {
  data: {
    subscriptions: { items: { id: string }[]; totalCount: number };
    products: { items: unknown[]; totalCount: number };
  };
}
// supertest는 본문을 any로 준다. 단언 전에 응답 모양을 이름 붙여 읽는다
const listOf = (response: { body: unknown }) => (response.body as ListBody).data;
const markersOf = (response: { body: unknown }) => (response.body as MapBody).data.markers;
const dataOf = (response: { body: unknown }) => (response.body as { data: unknown }).data;
const searchOf = (response: { body: unknown }) => (response.body as SearchBody).data;

/**
 * 목록 한 칸(공고 × 단지)을 공고·단지·칸으로 나눠 넣는다. 공고 id는 `${id}-notice`, 단지 id는 `${id}-complex`라
 * 칸 id로 시작하는 것만 지우면 함께 지워진다. match가 null이면 단지 없는 공고 단위 칸이고 title이 공고명이 된다
 */
interface ListingFixture {
  id: string;
  title: string;
  agencyCode: number;
  regionCode: number;
  match?: 'ADDRESS' | 'NAME' | 'MANUAL' | null;
  address?: string;
  sigungu?: string;
  lat?: number;
  lng?: number;
  households?: number | null;
  imageUrl?: string;
  supplyType?: string;
  postDate?: Date;
  applyUrl?: string;
  cancelledAt?: Date;
  applyStartDate?: Date;
  applyEndDate?: Date;
  contractStartDate?: Date;
  contractEndDate?: Date;
  moveInMonth?: string;
  supplyUnits?: number;
  recruitCount?: number;
  applicationCount?: number | null;
  units?: Omit<Prisma.SubscriptionUnitCreateWithoutSubscriptionInput, 'displayOrder'>[];
  floorplans?: Prisma.FloorplanCreateWithoutComplexInput[];
}

describe('청약 공고 API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const get = (path: string) => request(app.getHttpServer()).get(path);
  // 항목은 다시 읽을 때 같은 조건으로 한 번 더 걸러져, id만 보면 건수 SQL이 너무 넓어도 드러나지 않는다.
  // 한 페이지에 다 들어오는 조회에서 건수와 항목 수가 같은지 함께 본다
  const listIds = async (query: string) => {
    const response = await get(`/api/subscriptions${query}`).expect(200);
    const { items, totalCount } = listOf(response);
    expect(totalCount).toBe(items.length);
    return items.map((item) => item.id);
  };

  const createListing = async ({
    id,
    title,
    agencyCode,
    regionCode,
    match = 'MANUAL',
    units = [],
    floorplans = [],
    ...fields
  }: ListingFixture) => {
    const noticeLevel = match === null;
    const noticeTitle = noticeLevel ? title : `${title} 모집공고`;
    await prisma.notice.create({
      data: {
        id: `${id}-notice`,
        agencyCode,
        title: noticeTitle,
        titleKey: noticeTitle,
        supplyCategory: 'PUBLIC_RENTAL',
        supplyType: fields.supplyType,
        postDate: fields.postDate,
        applyUrl: fields.applyUrl,
        cancelledAt: fields.cancelledAt,
        origin: 'SYNC',
      },
    });
    if (!noticeLevel) {
      await prisma.complex.create({
        data: {
          id: `${id}-complex`,
          agencyCode,
          regionCode,
          name: title,
          address: fields.address,
          sigungu: fields.sigungu,
          lat: fields.lat,
          lng: fields.lng,
          households: fields.households,
          imageUrl: fields.imageUrl,
          floorplans: { create: floorplans },
        },
      });
    }
    await prisma.subscription.create({
      data: {
        id,
        noticeId: `${id}-notice`,
        complexId: noticeLevel ? null : `${id}-complex`,
        complexMatch: match,
        regionCode,
        applyStartDate: fields.applyStartDate,
        applyEndDate: fields.applyEndDate,
        contractStartDate: fields.contractStartDate,
        contractEndDate: fields.contractEndDate,
        moveInMonth: fields.moveInMonth,
        supplyUnits: fields.supplyUnits,
        recruitCount: fields.recruitCount,
        applicationCount: fields.applicationCount,
        units: { create: units.map((unit, order) => ({ ...unit, displayOrder: order })) },
      },
    });
  };

  // 칸이 공고·단지를 RESTRICT로, 평면도가 단지를 RESTRICT로 가리켜 칸 → 공고 → 평면도 → 단지 순으로 지운다
  const removeListings = async (prefix: string) => {
    await prisma.subscription.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.notice.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.floorplan.deleteMany({ where: { complexId: { startsWith: prefix } } });
    await prisma.complex.deleteMany({ where: { id: { startsWith: prefix } } });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Clock)
      .useValue({ now: () => FIXED_NOW })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await removeListings('');
    await createListing({
      id: 'e2e-open',
      title: '테스트 행복주택',
      agencyCode: 2,
      regionCode: 1,
      address: '서울특별시 중구 세종대로 110',
      sigungu: '중구',
      lat: 37.5663,
      lng: 126.9779,
      supplyType: '행복주택',
      households: 40,
      supplyUnits: 4,
      recruitCount: 12,
      applicationCount: 10,
      postDate: day('2026-09-01'),
      applyStartDate: day('2026-09-07'),
      applyEndDate: day('2026-09-11'),
      contractStartDate: day('2026-10-05'),
      contractEndDate: day('2026-10-09'),
      moveInMonth: '2027-03',
      applyUrl: 'https://www.i-sh.co.kr',
      imageUrl: '/housing/e2e/exterior.png',
      units: [
        { label: '114B', sizeType: '114', unitType: 'B', exclusiveArea: 114.97, supplyHouseholds: 4 },
        {
          label: '39A',
          sizeType: '39',
          unitType: 'A',
          exclusiveArea: 39.5,
          supplyHouseholds: 20,
          depositWon: 30_000_000n,
        },
      ],
      floorplans: [
        {
          id: 'e2e-open-b',
          floor: '3',
          unitNumber: '302',
          sizeType: '39',
          exclusiveArea: 39.98,
          has3d: false,
          displayOrder: 1,
        },
        {
          id: 'e2e-open-a',
          floor: '2-3',
          unitNumber: '201',
          sizeType: '39',
          exclusiveArea: 39.5,
          image2dUrl: '/plans/a.png',
          has3d: true,
          displayOrder: 0,
        },
      ],
    });
    await createListing({
      id: 'e2e-upcoming',
      title: '접수 예정 매입임대',
      agencyCode: 1,
      regionCode: 3,
      match: 'ADDRESS',
      address: '경기도 수원시',
      lat: 37.26,
      lng: 127.03,
      households: 100,
      supplyUnits: 2,
      applicationCount: 2,
      applyStartDate: day('2026-09-20'),
      applyEndDate: day('2026-09-25'),
      floorplans: [{ id: 'e2e-upcoming-a', sizeType: '22', exclusiveArea: 22 }],
    });
    await createListing({
      id: 'e2e-nocoord',
      title: '좌표 없는 마감 공고',
      agencyCode: 1,
      regionCode: 1,
      address: '서울특별시 도봉구',
      households: 9,
      applyStartDate: day('2026-08-01'),
      applyEndDate: day('2026-08-05'),
      floorplans: [{ id: 'e2e-nocoord-a', sizeType: '14', exclusiveArea: 14.6475 }],
    });
    // 이름으로만 이은 단지 — 같은 이름의 다른 건물일 수 있어 평면도(17㎡)를 보이지도, 면적 조건에 쓰지도 않는다
    await createListing({
      id: 'e2e-name',
      title: '이름만 같은 건물',
      agencyCode: 1,
      regionCode: 1,
      match: 'NAME',
      sigungu: '노원구',
      floorplans: [{ id: 'e2e-name-a', sizeType: '17', exclusiveArea: 17 }],
    });
    // 단지·건물 정보가 원천에 없는 공고(주택 목록이 첨부 파일뿐) — 공고 단위 칸 하나로 올린다
    await createListing({
      id: 'e2e-notice',
      title: '경기북부 청년 주택 선착순 모집',
      agencyCode: 1,
      regionCode: 3,
      match: null,
    });
  });

  afterAll(async () => {
    await removeListings('');
    await app.close();
  });

  describe('API-011 상세', () => {
    it('성공 엔벌로프로 상세를 주고, 상태·D-day는 한국 날짜로 계산한다', async () => {
      const response = await get('/api/subscriptions/e2e-open').expect(200);
      expect(response.body).toEqual({
        success: true,
        error: null,
        data: {
          id: 'e2e-open',
          title: '테스트 행복주택',
          noticeTitle: '테스트 행복주택 모집공고',
          agencyCode: 2,
          agencyName: '서울주택도시공사',
          statusCode: 2,
          dday: 3,
          region: 1,
          address: '서울특별시 중구 세종대로 110',
          lat: 37.5663,
          lng: 126.9779,
          postDate: '2026-09-01',
          applyStartDate: '2026-09-07',
          deadline: '2026-09-11',
          contractDate: '2026-10-05',
          supplyType: '행복주택',
          households: 40,
          supplyUnits: 4,
          recruitCount: 12,
          applicationCount: 10,
          moveIn: '2027-03',
          competition: '2.5:1',
          imageUrl: '/housing/e2e/exterior.png',
          // 주택형은 넣은 순서가 아니라 전용면적 순이다(114가 39보다 뒤)
          units: [
            {
              size: '39',
              type: 'A',
              label: '39A',
              floor: null,
              unitNumber: null,
              households: 20,
              price: '보증금 3,000만 원',
            },
            { size: '114', type: 'B', label: '114B', floor: null, unitNumber: null, households: 4, price: null },
          ],
          applyUrl: 'https://www.i-sh.co.kr',
          floorplans: [
            {
              id: 'e2e-open-a',
              size: '39',
              type: null,
              floor: '2-3',
              unitNumber: '201',
              exclusiveArea: 39.5,
              has2d: true,
              has3d: true,
            },
            {
              id: 'e2e-open-b',
              size: '39',
              type: null,
              floor: '3',
              unitNumber: '302',
              exclusiveArea: 39.98,
              has2d: false,
              has3d: false,
            },
          ],
        },
      });
    });

    it('이름으로만 이은 단지는 평면도를 주지 않고, 주소가 없으면 지역·시군구로 위치를 준다', async () => {
      const detail = dataOf(await get('/api/subscriptions/e2e-name').expect(200));
      expect(detail).toMatchObject({ title: '이름만 같은 건물', address: '서울 노원구', floorplans: [] });
    });

    it('단지 정보가 없는 공고 단위 칸은 공고명과 지역으로 보인다', async () => {
      const detail = dataOf(await get('/api/subscriptions/e2e-notice').expect(200));
      expect(detail).toMatchObject({
        title: '경기북부 청년 주택 선착순 모집',
        noticeTitle: '경기북부 청년 주택 선착순 모집',
        address: '경기',
        lat: null,
        households: null,
        statusCode: null,
        floorplans: [],
      });
    });

    it('없는 공고·없는 경로는 ERR-008, 지나치게 긴 id는 ERR-005로 실패 엔벌로프를 준다', async () => {
      const notFound = { success: false, data: null, error: { code: 'E009', message: 'NOT_FOUND' } };
      expect((await get('/api/subscriptions/none').expect(404)).body).toEqual(notFound);
      expect((await get('/api/no-such-route').expect(404)).body).toEqual(notFound);
      expect((await get(`/api/subscriptions/${'a'.repeat(101)}`).expect(422)).body).toEqual({
        success: false,
        data: null,
        error: { code: 'E006', message: 'VALIDATION_ERROR' },
      });
    });
  });

  describe('API-010 목록', () => {
    const ALL = ['e2e-open', 'e2e-name', 'e2e-nocoord', 'e2e-notice', 'e2e-upcoming'];

    it('평면도가 없는 칸·공고 단위 칸도 올리고, 마감 임박순으로 접수 중이 아닌 칸은 뒤로 보낸다', async () => {
      const response = await get('/api/subscriptions').expect(200);
      expect(dataOf(response)).toMatchObject({ page: 1, pageSize: 20, totalCount: 5 });
      expect(listOf(response).items.map((item) => item.id)).toEqual(ALL);
      expect(listOf(response).items[0]).toEqual({
        id: 'e2e-open',
        title: '테스트 행복주택',
        noticeTitle: '테스트 행복주택 모집공고',
        agencyCode: 2,
        region: 1,
        address: '서울특별시 중구 세종대로 110',
        lat: 37.5663,
        lng: 126.9779,
        supplyType: '행복주택',
        // 주택형과 평면도의 전용면적을 합친다(39.5는 둘 다에 있다)
        sizes: [39.5, 39.98, 114.97],
        households: 40,
        applicationCount: 10,
        competition: '2.5:1',
        moveIn: '2027-03',
        deadline: '2026-09-11',
        dday: 3,
        statusCode: 2,
        imageUrl: '/housing/e2e/exterior.png',
      });
    });

    it.each([
      ['?agency=1', ['e2e-name', 'e2e-nocoord', 'e2e-notice', 'e2e-upcoming']],
      ['?region=3', ['e2e-notice', 'e2e-upcoming']],
      ['?status=2', ['e2e-open']],
      ['?status=3', ['e2e-nocoord']],
      ['?size=30-', ['e2e-open']],
      ['?size=0-15', ['e2e-nocoord']],
      // 이름으로만 이은 단지의 평면도(17㎡)는 면적 조건에 쓰지 않는다
      ['?size=15-20', []],
      ['?keyword=%ED%96%89%EB%B3%B5', ['e2e-open']],
      ['?keyword=lh', ['e2e-name', 'e2e-nocoord', 'e2e-notice', 'e2e-upcoming']],
      ['?keyword=%EA%B2%BD%EA%B8%B0', ['e2e-notice', 'e2e-upcoming']],
      // 주소(세종대로)·시군구(노원)·공고명(선착순)으로도 찾는다
      ['?keyword=%EC%84%B8%EC%A2%85%EB%8C%80%EB%A1%9C', ['e2e-open']],
      ['?keyword=%EB%85%B8%EC%9B%90', ['e2e-name']],
      ['?keyword=%EC%84%A0%EC%B0%A9%EC%88%9C', ['e2e-notice']],
      ['?keyword=%25', []],
      ['?keyword=_', []],
      ['?region=0&agency=0&status=0', ALL],
    ])('조건 %s → %j', async (query, expected) => {
      expect(await listIds(query)).toEqual(expected);
    });

    it('매입임대처럼 소수 넷째 자리까지 있는 전용면적을 반올림하지 않는다', async () => {
      const response = await get('/api/subscriptions?size=0-15').expect(200);
      expect(listOf(response).items[0].sizes).toEqual([14.6475]);
    });

    it('세대 수·경쟁률 정렬과 페이지 나누기', async () => {
      expect(await listIds('?sort=HOUSEHOLDS')).toEqual([
        'e2e-upcoming',
        'e2e-open',
        'e2e-nocoord',
        'e2e-name',
        'e2e-notice',
      ]);
      expect(await listIds('?sort=COMPETITION')).toEqual([
        'e2e-upcoming',
        'e2e-open',
        'e2e-name',
        'e2e-nocoord',
        'e2e-notice',
      ]);
      const page = await get('/api/subscriptions?page=2&pageSize=2').expect(200);
      expect(listOf(page).items.map((item) => item.id)).toEqual(['e2e-nocoord', 'e2e-notice']);
      expect(listOf(page).totalCount).toBe(5);
    });

    it.each(['?sort=POPULAR', '?pageSize=101', '?page=0', '?region=9', '?size=39', '?unknown=1'])(
      '정의하지 않은 값 %s는 ERR-005다',
      async (query) => {
        const response = await get(`/api/subscriptions${query}`).expect(422);
        expect((response.body as ErrorBody).error).toEqual({ code: 'E006', message: 'VALIDATION_ERROR' });
      },
    );
  });

  // 정렬·페이지는 DB가 SQL로 한다 — 값이 없을 때, 같을 때, 경계에서 web 정렬 규칙과 같은지 본다.
  // 다른 칸과 섞이지 않게 인천(region=2)에만 둔다(오늘 9/8)
  describe('정렬·면적 경계', () => {
    const SORT_FIXTURES = [
      // 접수 중 D-2, 경쟁률 1, 50세대, 면적 25(20-25가 아니라 25-30)
      {
        id: 'e2e-sort-a',
        applyStartDate: day('2026-09-01'),
        applyEndDate: day('2026-09-10'),
        supplyUnits: 4,
        applicationCount: 4,
        households: 50,
        area: 25,
      },
      // a와 D-day가 같다 — id를 문자 코드 순으로 가르면 대문자 B가 a보다 앞이다. 공급 호수 0이라 경쟁률 없음
      {
        id: 'e2e-sort-B',
        applyStartDate: day('2026-09-01'),
        applyEndDate: day('2026-09-10'),
        supplyUnits: 0,
        applicationCount: 10,
        households: null,
        area: 24.9999,
      },
      // 오늘 마감(D-0), 경쟁률 0.5, a와 세대 수가 같다, 면적 30(30- 구간)
      {
        id: 'e2e-sort-c',
        applyStartDate: day('2026-09-01'),
        applyEndDate: day('2026-09-08'),
        supplyUnits: 2,
        applicationCount: 1,
        households: 50,
        area: 30,
      },
      // 일정상 접수 중이지만 공고가 취소됐다 — D-day가 없다. 경쟁률은 a와 같은 1
      {
        id: 'e2e-sort-d',
        applyStartDate: day('2026-09-01'),
        applyEndDate: day('2026-09-10'),
        supplyUnits: 3,
        applicationCount: 3,
        households: 10,
        cancelledAt: new Date('2026-09-02T00:00:00Z'),
        area: 15,
      },
      // 일정·신청 인원 없음, 세대 수 가장 많음, 면적 14.9999(0-15)
      { id: 'e2e-sort-e', supplyUnits: 5, applicationCount: null, households: 200, area: 14.9999 },
    ];
    const inIncheon = (query = '') => listIds(`?region=2${query}`);

    beforeAll(async () => {
      for (const { area, ...fixture } of SORT_FIXTURES) {
        await createListing({
          ...fixture,
          title: `정렬 ${fixture.id}`,
          agencyCode: 4,
          regionCode: 2,
          address: '인천광역시',
          floorplans: [{ id: `${fixture.id}-plan`, exclusiveArea: area }],
        });
      }
    });

    afterAll(async () => {
      await removeListings('e2e-sort-');
    });

    it('마감 임박순: D-day 작은 순, 같으면 id 문자 코드 순, 접수 중이 아니면(취소 포함) 뒤', async () => {
      expect(await inIncheon()).toEqual(['e2e-sort-c', 'e2e-sort-B', 'e2e-sort-a', 'e2e-sort-d', 'e2e-sort-e']);
      const response = await get('/api/subscriptions?region=2').expect(200);
      expect(listOf(response).items.find((item) => item.id === 'e2e-sort-d')?.statusCode).toBe(4);
    });

    it('경쟁률순: 낮은 순, 공급 호수가 0이거나 신청 인원을 모르면 뒤', async () => {
      expect(await inIncheon('&sort=COMPETITION')).toEqual([
        'e2e-sort-c',
        'e2e-sort-a',
        'e2e-sort-d',
        'e2e-sort-B',
        'e2e-sort-e',
      ]);
    });

    it('세대수순: 많은 순, 같으면 id 순, 모르면 뒤', async () => {
      expect(await inIncheon('&sort=HOUSEHOLDS')).toEqual([
        'e2e-sort-e',
        'e2e-sort-a',
        'e2e-sort-c',
        'e2e-sort-d',
        'e2e-sort-B',
      ]);
    });

    it('페이지는 정렬한 순서로 나누고 전체 건수는 따로 센다', async () => {
      const response = await get('/api/subscriptions?region=2&page=2&pageSize=2').expect(200);
      expect(listOf(response).items.map((item) => item.id)).toEqual(['e2e-sort-a', 'e2e-sort-d']);
      expect(listOf(response).totalCount).toBe(5);
    });

    it.each([
      ['0-15', ['e2e-sort-e']],
      ['15-20', ['e2e-sort-d']],
      ['20-25', ['e2e-sort-B']],
      ['25-30', ['e2e-sort-a']],
      ['30-', ['e2e-sort-c']],
    ])('면적 구간 %s는 왼쪽 경계만 포함한다 → %j', async (size, expected) => {
      expect(await inIncheon(`&size=${size}`)).toEqual(expected);
    });
  });

  // 주택형 면적 구간("70~80㎡")·단지 면적 범위로도 면적 조건을 건다(ERD §5 규칙 11). 경기 GH(agency=3)에만 둔다.
  // 겹침은 구간 경계에서 갈린다 — 면적 범위는 양 끝을 포함하고, 필터 구간은 왼쪽만 포함한다
  describe('면적 구간 규칙', () => {
    beforeAll(async () => {
      // [20, 22]: 하한이 15-20의 상한(20, 제외)과 같아 15-20에는 들지 않는다
      await createListing({
        id: 'e2e-area-range',
        title: '구간 주택형',
        agencyCode: 3,
        regionCode: 3,
        units: [{ label: '20~22㎡', areaMin: 20, areaMax: 22 }],
      });
      // [10, 15]: 상한이 15-20의 하한(15, 포함)과 같아 15-20에도 든다
      await createListing({
        id: 'e2e-area-touch',
        title: '경계 주택형',
        agencyCode: 3,
        regionCode: 3,
        units: [{ label: '10~15㎡', areaMin: 10, areaMax: 15 }],
      });
      // 주택형 행이 없고 단지 면적 범위만 있다(영구임대 DDO_AR "21.78~29.43" 꼴)
      await createListing({ id: 'e2e-area-complex', title: '단지 범위', agencyCode: 3, regionCode: 3 });
      await prisma.complex.update({
        where: { id: 'e2e-area-complex-complex' },
        data: { areaMin: 21.78, areaMax: 24.5 },
      });
      // 주택형 행이 있으면 단지 범위(26~28)는 보지 않는다 — 다른 칸도 25-30이 없어 선택지에서도 빠져야 한다
      await createListing({
        id: 'e2e-area-unit-wins',
        title: '주택형 우선',
        agencyCode: 3,
        regionCode: 3,
        units: [{ label: '40A', sizeType: '40', exclusiveArea: 40 }],
      });
      await prisma.complex.update({
        where: { id: 'e2e-area-unit-wins-complex' },
        data: { areaMin: 26, areaMax: 28 },
      });
    });

    afterAll(async () => {
      await removeListings('e2e-area-');
    });

    it.each([
      ['0-15', ['e2e-area-touch']],
      ['15-20', ['e2e-area-touch']],
      ['20-25', ['e2e-area-complex', 'e2e-area-range']],
      ['25-30', []],
      ['30-', ['e2e-area-unit-wins']],
    ])('구간 %s → %j', async (size, expected) => {
      expect(await listIds(`?agency=3&size=${size}`)).toEqual(expected);
    });

    it('필터 선택지는 목록과 같은 규칙으로 센다 — 구간마다 목록이 비지 않을 때만 선택지가 있다', async () => {
      const options = dataOf(await get('/api/subscriptions/filter-options').expect(200)) as {
        sizeRanges: { value: string }[];
      };
      const offered = options.sizeRanges.map((range) => range.value);
      expect(offered).toEqual(['0-15', '15-20', '20-25', '30-']);
      for (const size of ['0-15', '15-20', '20-25', '25-30', '30-']) {
        const listed = (await listIds(`?size=${size}&pageSize=100`)).length > 0;
        expect([size, listed]).toEqual([size, offered.includes(size)]);
      }
    });

    it('구간으로만 온 주택형은 sizes에 넣지 않는다', async () => {
      const response = await get('/api/subscriptions?agency=3&size=0-15').expect(200);
      expect(listOf(response).items[0].sizes).toEqual([]);
    });
  });

  describe('API-012 지도', () => {
    it('좌표가 있는 단지의 칸만 핀으로 주고, 고정 경로가 공고 id로 잡히지 않는다', async () => {
      const response = await get('/api/subscriptions/map').expect(200);
      expect(markersOf(response).map((marker) => marker.id)).toEqual(['e2e-open', 'e2e-upcoming']);
      expect(markersOf(response)[0]).toEqual({
        id: 'e2e-open',
        title: '테스트 행복주택',
        lat: 37.5663,
        lng: 126.9779,
        dday: 3,
        agencyCode: 2,
        statusCode: 2,
      });
    });

    it('영역(남,서,북,동) 안의 핀만 주고, 형식이 틀리거나 뒤집힌 영역은 ERR-005다', async () => {
      const seoul = await get('/api/subscriptions/map?bounds=37.4,126.8,37.7,127.2').expect(200);
      expect(markersOf(seoul).map((marker) => marker.id)).toEqual(['e2e-open']);
      await get('/api/subscriptions/map?bounds=37.4,126.8,37.7').expect(422);
      await get('/api/subscriptions/map?bounds=37.7,126.8,37.4,127.2').expect(422);
    });
  });

  describe('필터 선택지', () => {
    it('목록에 있는 지역·기관·상태·면적 구간만 준다 — 이름으로만 이은 단지의 평면도 면적(15-20)은 빼고 센다', async () => {
      const response = await get('/api/subscriptions/filter-options').expect(200);
      expect(dataOf(response)).toEqual({
        regions: [1, 3],
        agencies: [1, 2],
        statuses: [1, 2, 3],
        sizeRanges: [
          { value: '0-15', min: 0, max: 15 },
          { value: '20-25', min: 20, max: 25 },
          { value: '30-', min: 30, max: null },
        ],
      });
    });
  });

  describe('API-095 통합 검색', () => {
    const searchIds = async (query: string) => {
      const response = await get(`/api/search${query}`).expect(200);
      return searchOf(response).subscriptions.items.map((item) => item.id);
    };

    it('목록과 같은 필드에서 찾고, 가구는 커머스 전이라 비어 있다', async () => {
      const response = await get(`/api/search?q=${encodeURIComponent('서울')}`).expect(200);
      expect(searchOf(response)).toEqual({
        page: 1,
        pageSize: 20,
        subscriptions: {
          items: [expect.objectContaining({ id: 'e2e-open', dday: 3 }), expect.anything(), expect.anything()],
          totalCount: 3,
        },
        products: { items: [], totalCount: 0 },
      });
      expect(await searchIds('?q=lh')).toEqual(['e2e-name', 'e2e-nocoord', 'e2e-notice', 'e2e-upcoming']);
      expect(await searchIds(`?q=${encodeURIComponent('선착순')}`)).toEqual(['e2e-notice']);
      expect(await searchIds(`?q=${encodeURIComponent('없는 건물')}`)).toEqual([]);
    });

    it('제목 일치 → 앞부분 → 포함 → 다른 필드 순으로 세우고, 페이지를 나눠도 전체 건수는 따로 센다', async () => {
      const fixtures = [
        { id: 'e2e-rank-same', title: '매입임대' },
        { id: 'e2e-rank-prefix', title: '매입임대 2차' },
        { id: 'e2e-rank-field', title: '청년 주택', supplyType: '매입임대' },
      ];
      for (const fixture of fixtures) {
        await createListing({
          ...fixture,
          agencyCode: 3,
          regionCode: 3,
          address: '경기도 성남시',
          floorplans: [{ id: `${fixture.id}-a`, exclusiveArea: 20 }],
        });
      }
      try {
        const keyword = encodeURIComponent('  매입임대 ');
        expect(await searchIds(`?q=${keyword}`)).toEqual([
          'e2e-rank-same',
          'e2e-rank-prefix',
          'e2e-upcoming',
          'e2e-rank-field',
        ]);
        expect(await searchIds(`?q=${keyword}&pageSize=2`)).toEqual(['e2e-rank-same', 'e2e-rank-prefix']);
        const second = await get(`/api/search?q=${keyword}&page=2&pageSize=2`).expect(200);
        expect(searchOf(second)).toMatchObject({ page: 2, pageSize: 2 });
        expect(searchOf(second).subscriptions.items.map((item) => item.id)).toEqual(['e2e-upcoming', 'e2e-rank-field']);
        expect(searchOf(second).subscriptions.totalCount).toBe(4);
        expect(await searchIds(`?q=${keyword}&page=3&pageSize=2`)).toEqual([]);
      } finally {
        await removeListings('e2e-rank-');
      }
    });

    it.each([
      '',
      '?q=',
      '?q=%20%20',
      '?q=%00',
      '?q=a&q=b',
      `?q=${encodeURIComponent('가'.repeat(101))}`,
      '?q=a&page=0',
      '?q=a&pageSize=0',
      '?q=a&pageSize=101',
      '?q=a&pageSize=1.5',
      '?q=a&pageSize=-1',
      '?q=a&limit=10',
      '?q=a&type=x',
    ])('검색어가 없거나 형식이 틀린 %s는 ERR-005다', async (query) => {
      const response = await get(`/api/search${query}`).expect(422);
      expect((response.body as ErrorBody).error).toEqual({ code: 'E006', message: 'VALIDATION_ERROR' });
    });

    it('검색어는 앞뒤 공백을 버린 뒤 100자까지, 빈 페이지 값은 기본값으로 받는다', async () => {
      const longest = encodeURIComponent(` ${'가'.repeat(100)} `);
      expect(searchOf(await get(`/api/search?q=${longest}`).expect(200)).subscriptions.totalCount).toBe(0);
      expect(searchOf(await get('/api/search?q=lh&page=&pageSize=').expect(200))).toMatchObject({
        page: 1,
        pageSize: 20,
      });
    });
  });

  describe('상태 규칙', () => {
    // 오늘(9/8)을 기준으로 날짜 경계마다 한 건씩 — 상태 필터(SQL)와 응답의 statusCode(앱 계산)가 같은 규칙인지 본다.
    // 시작이 마감보다 늦은 일정은 DB가 받지 않는다(공통 테스트)
    const BOUNDARY_CASES: {
      id: string;
      start: string | null;
      end: string | null;
      cancelled?: boolean;
      expected: number | null;
    }[] = [
      { id: 'st-start-today', start: '2026-09-08', end: '2026-09-12', expected: 2 },
      { id: 'st-end-today', start: '2026-09-01', end: '2026-09-08', expected: 2 },
      { id: 'st-start-tomorrow', start: '2026-09-09', end: '2026-09-12', expected: 1 },
      { id: 'st-end-yesterday', start: '2026-09-01', end: '2026-09-07', expected: 3 },
      { id: 'st-no-schedule', start: null, end: null, expected: null },
      { id: 'st-start-only', start: '2026-09-01', end: null, expected: null },
      // 시작이 미래라도 마감을 모르면 접수예정이 아니다(앱 계산과 같게)
      { id: 'st-future-start-only', start: '2026-09-20', end: null, expected: null },
      { id: 'st-cancelled', start: '2026-09-07', end: '2026-09-11', cancelled: true, expected: 4 },
    ];

    beforeAll(async () => {
      for (const { id, start, end, cancelled } of BOUNDARY_CASES) {
        await createListing({
          id,
          title: id,
          agencyCode: 1,
          regionCode: 1,
          address: '서울',
          applyStartDate: start ? day(start) : undefined,
          applyEndDate: end ? day(end) : undefined,
          cancelledAt: cancelled ? new Date('2026-09-02T00:00:00Z') : undefined,
          floorplans: [{ id: `${id}-a`, exclusiveArea: 20 }],
        });
      }
    });

    afterAll(async () => {
      await removeListings('st-');
    });

    it('날짜 경계마다 상태를 계산하고, 상태 필터는 같은 규칙으로 거른다', async () => {
      const everything = listOf(await get('/api/subscriptions?pageSize=100').expect(200)).items;
      const statusById = new Map(everything.map((item) => [item.id, item.statusCode]));
      for (const { id, expected } of BOUNDARY_CASES) expect([id, statusById.get(id)]).toEqual([id, expected]);
      for (const code of [1, 2, 3, 4]) {
        const filtered = (await listIds(`?status=${code}&pageSize=100`)).sort();
        const computed = everything
          .filter((item) => item.statusCode === code)
          .map((item) => item.id)
          .sort();
        expect([code, filtered]).toEqual([code, computed]);
      }
    });

    it('필터 선택지의 상태도 같은 규칙으로 센다', async () => {
      expect(
        (dataOf(await get('/api/subscriptions/filter-options').expect(200)) as { statuses: number[] }).statuses,
      ).toEqual([1, 2, 3, 4]);
    });
  });

  describe('입력 경계', () => {
    it('검색어의 %·\\는 와일드카드가 아니라 글자로 찾는다', async () => {
      await createListing({
        id: 'e2e-special',
        title: '당첨 100% \\ 특별공고',
        agencyCode: 4,
        regionCode: 2,
        address: '인천',
        floorplans: [{ id: 'e2e-special-a', exclusiveArea: 18 }],
      });
      try {
        expect(await listIds('?keyword=%25')).toEqual(['e2e-special']);
        expect(await listIds('?keyword=%5C')).toEqual(['e2e-special']);
        expect(await listIds('?keyword=0%25')).toEqual(['e2e-special']);
        expect(await listIds('?keyword=_')).toEqual([]);
      } finally {
        await removeListings('e2e-special');
      }
    });

    it.each(['/api/subscriptions?keyword=%00', '/api/subscriptions/map?keyword=%00', '/api/subscriptions/a%00b'])(
      'NUL 문자가 든 %s는 DB 오류(500)가 아니라 ERR-005다',
      async (path) => {
        const response = await get(path).expect(422);
        expect((response.body as ErrorBody).error).toEqual({ code: 'E006', message: 'VALIDATION_ERROR' });
      },
    );

    it('빈 값은 조건을 걸지 않은 것으로 보고, 정수가 아닌 코드는 막는다', async () => {
      const response = await get(
        '/api/subscriptions?region=&agency=&status=&size=&sort=&page=&pageSize=&keyword=',
      ).expect(200);
      expect(dataOf(response)).toMatchObject({ page: 1, pageSize: 20, totalCount: 5 });
      expect(listOf(response).items.map((item) => item.id)).toEqual([
        'e2e-open',
        'e2e-name',
        'e2e-nocoord',
        'e2e-notice',
        'e2e-upcoming',
      ]);
      expect(markersOf(await get('/api/subscriptions/map?bounds=').expect(200))).toHaveLength(2);
      await get('/api/subscriptions?region=%20').expect(422);
      await get('/api/subscriptions?region=0x3').expect(422);
      await get('/api/subscriptions?page=1.5').expect(422);
    });

    it.each([
      ['-90,-180,90,180', 200],
      ['37.4,126.8,91,127.2', 422],
      ['37.4,126.8,37.7,181', 422],
      [`0,0,${'9'.repeat(400)},1`, 422],
    ])('지도 영역 %s는 %s', async (bounds, status) => {
      await get(`/api/subscriptions/map?bounds=${bounds}`).expect(status);
    });

    it('목록 전용 조건(정렬·페이지)은 지도에서 받지 않는다', async () => {
      await get('/api/subscriptions/map?sort=DEADLINE').expect(422);
      await get('/api/subscriptions/map?page=1').expect(422);
    });
  });

  describe('DB 제약', () => {
    afterEach(async () => {
      await removeListings('e2e-bad');
    });

    it('정의서에 없는 기관 코드는 DB가 받지 않는다(ITF-001 1~4)', async () => {
      await expect(
        prisma.notice.create({
          data: { id: 'e2e-bad', agencyCode: 9, title: 'x', titleKey: 'x', supplyCategory: 'SALE', origin: 'SYNC' },
        }),
      ).rejects.toThrow(/notices_agency_code_check/);
    });

    it('접수 시작이 마감보다 늦은 칸은 받지 않는다', async () => {
      await expect(
        createListing({
          id: 'e2e-bad-period',
          title: 'x',
          agencyCode: 1,
          regionCode: 1,
          applyStartDate: day('2026-09-10'),
          applyEndDate: day('2026-09-05'),
        }),
      ).rejects.toThrow(/subscriptions_apply_period_check/);
    });

    it('면적 범위는 하한·상한이 함께 있어야 한다', async () => {
      await expect(
        createListing({
          id: 'e2e-bad-range',
          title: 'x',
          agencyCode: 1,
          regionCode: 1,
          units: [{ label: '35㎡ 이하', areaMax: 35 }],
        }),
      ).rejects.toThrow(/subscription_units_area_pair_check/);
    });

    it('단지를 정한 방법은 단지가 있을 때만 있다', async () => {
      await createListing({ id: 'e2e-bad-match', title: 'x', agencyCode: 1, regionCode: 1, match: null });
      await expect(
        prisma.subscription.update({ where: { id: 'e2e-bad-match' }, data: { complexMatch: 'NAME' } }),
      ).rejects.toThrow(/subscriptions_complex_match_presence_check/);
    });

    it('공고 단위 칸은 공고당 하나다', async () => {
      await createListing({ id: 'e2e-bad-twice', title: 'x', agencyCode: 1, regionCode: 1, match: null });
      await expect(
        prisma.subscription.create({ data: { id: 'e2e-bad-twice-2', noticeId: 'e2e-bad-twice-notice', regionCode: 1 } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('평면도가 있는 단지는 지워지지 않는다 — 평면도는 단지 삭제에 딸려 사라지지 않는다', async () => {
      await createListing({
        id: 'e2e-bad-plan',
        title: 'x',
        agencyCode: 1,
        regionCode: 1,
        floorplans: [{ id: 'e2e-bad-plan-a', exclusiveArea: 20 }],
      });
      await prisma.subscription.delete({ where: { id: 'e2e-bad-plan' } });
      await expect(prisma.complex.delete({ where: { id: 'e2e-bad-plan-complex' } })).rejects.toMatchObject({
        code: 'P2003',
      });
      expect(await prisma.floorplan.count({ where: { complexId: 'e2e-bad-plan-complex' } })).toBe(1);
    });
  });

  describe('공통', () => {
    it('본문이 너무 크거나 문자셋이 잘못된 요청은 서버 오류가 아니라 요청 오류로 돌려준다', async () => {
      const tooLarge = await request(app.getHttpServer())
        .post('/api/subscriptions/e2e-open')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ text: 'x'.repeat(200_000) }))
        .expect(413);
      expect(tooLarge.body).toEqual({
        success: false,
        data: null,
        error: { code: 'E016', message: 'PAYLOAD_TOO_LARGE' },
      });
      const badCharset = await request(app.getHttpServer())
        .post('/api/subscriptions/e2e-open')
        .set('Content-Type', 'application/json; charset=foo')
        .send('{}')
        .expect(400);
      expect(badCharset.body).toEqual({ success: false, data: null, error: { code: 'E001', message: 'BAD_REQUEST' } });
    });
  });
});
