import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Clock } from '../src/common/time/clock.js';
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

describe('청약 공고 API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const get = (path: string) => request(app.getHttpServer()).get(path);
  const listIds = async (query: string) => {
    const response = await get(`/api/subscriptions${query}`).expect(200);
    return listOf(response).items.map((item) => item.id);
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
    await prisma.subscription.deleteMany();
    await prisma.subscription.create({
      data: {
        id: 'e2e-open',
        title: '테스트 행복주택',
        agencyCode: 2,
        regionCode: 1,
        address: '서울특별시 중구 세종대로 110',
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
        contractDate: day('2026-10-05'),
        moveInMonth: '2027-03',
        applyUrl: 'https://www.i-sh.co.kr',
        imageUrl: '/housing/e2e/exterior.png',
        units: {
          create: [
            { sizeType: '114', unitType: 'B', households: 4, price: null },
            { sizeType: '39', unitType: 'A', households: 20, price: '보증금 3,000만 원' },
          ],
        },
        floorplans: {
          create: [
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
        },
      },
    });
    await prisma.subscription.create({
      data: {
        id: 'e2e-upcoming',
        title: '접수 예정 매입임대',
        agencyCode: 1,
        regionCode: 3,
        address: '경기도 수원시',
        lat: 37.26,
        lng: 127.03,
        households: 100,
        supplyUnits: 2,
        applicationCount: 2,
        applyStartDate: day('2026-09-20'),
        applyEndDate: day('2026-09-25'),
        floorplans: { create: [{ id: 'e2e-upcoming-a', sizeType: '22', exclusiveArea: 22 }] },
      },
    });
    await prisma.subscription.create({
      data: {
        id: 'e2e-nocoord',
        title: '좌표 없는 마감 공고',
        agencyCode: 1,
        regionCode: 1,
        address: '서울특별시 도봉구',
        households: 9,
        applyStartDate: day('2026-08-01'),
        applyEndDate: day('2026-08-05'),
        floorplans: { create: [{ id: 'e2e-nocoord-a', sizeType: '14', exclusiveArea: 14.6475 }] },
      },
    });
    // 도면이 없는 공고는 목록·지도에 올리지 않는다(상세는 열린다)
    await prisma.subscription.create({
      data: {
        id: 'e2e-noplan',
        title: '도면 없는 공고',
        agencyCode: 1,
        regionCode: 1,
        address: '서울',
        lat: 37.5,
        lng: 127,
      },
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany();
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
          // 주택형은 문자열이 아니라 숫자 크기순이다("114"가 "39"보다 뒤)
          units: [
            { size: '39', type: 'A', households: 20, price: '보증금 3,000만 원' },
            { size: '114', type: 'B', households: 4, price: null },
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
    it('도면이 있는 공고만 마감 임박순으로 주고, 접수 중이 아닌 공고는 뒤로 보낸다', async () => {
      const response = await get('/api/subscriptions').expect(200);
      expect(dataOf(response)).toMatchObject({ page: 1, pageSize: 20, totalCount: 3 });
      expect(listOf(response).items.map((item) => item.id)).toEqual(['e2e-open', 'e2e-nocoord', 'e2e-upcoming']);
      expect(listOf(response).items[0]).toEqual({
        id: 'e2e-open',
        title: '테스트 행복주택',
        agencyCode: 2,
        region: 1,
        address: '서울특별시 중구 세종대로 110',
        lat: 37.5663,
        lng: 126.9779,
        supplyType: '행복주택',
        sizes: [39.5, 39.98],
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
      ['?agency=1', ['e2e-nocoord', 'e2e-upcoming']],
      ['?region=3', ['e2e-upcoming']],
      ['?status=2', ['e2e-open']],
      ['?status=3', ['e2e-nocoord']],
      ['?size=30-', ['e2e-open']],
      ['?size=0-15', ['e2e-nocoord']],
      ['?keyword=%ED%96%89%EB%B3%B5', ['e2e-open']],
      ['?keyword=lh', ['e2e-nocoord', 'e2e-upcoming']],
      ['?keyword=%EA%B2%BD%EA%B8%B0', ['e2e-upcoming']],
      ['?keyword=%25', []],
      ['?keyword=_', []],
      ['?region=0&agency=0&status=0', ['e2e-open', 'e2e-nocoord', 'e2e-upcoming']],
    ])('조건 %s → %j', async (query, expected) => {
      expect(await listIds(query)).toEqual(expected);
    });

    it('매입임대처럼 소수 넷째 자리까지 있는 전용면적을 반올림하지 않는다', async () => {
      const response = await get('/api/subscriptions?size=0-15').expect(200);
      expect(listOf(response).items[0].sizes).toEqual([14.6475]);
    });

    it('세대 수·경쟁률 정렬과 페이지 나누기', async () => {
      expect(await listIds('?sort=HOUSEHOLDS')).toEqual(['e2e-upcoming', 'e2e-open', 'e2e-nocoord']);
      expect(await listIds('?sort=COMPETITION')).toEqual(['e2e-upcoming', 'e2e-open', 'e2e-nocoord']);
      const page = await get('/api/subscriptions?page=2&pageSize=2').expect(200);
      expect(listOf(page).items.map((item) => item.id)).toEqual(['e2e-upcoming']);
      expect(listOf(page).totalCount).toBe(3);
    });

    it.each(['?sort=POPULAR', '?pageSize=101', '?page=0', '?region=9', '?size=39', '?unknown=1'])(
      '정의하지 않은 값 %s는 ERR-005다',
      async (query) => {
        const response = await get(`/api/subscriptions${query}`).expect(422);
        expect((response.body as ErrorBody).error).toEqual({ code: 'E006', message: 'VALIDATION_ERROR' });
      },
    );
  });

  describe('API-012 지도', () => {
    it('도면과 좌표가 있는 공고만 핀으로 주고, 고정 경로가 공고 id로 잡히지 않는다', async () => {
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
    it('목록에 있는 지역·기관·상태·면적 구간만 준다', async () => {
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
          items: [expect.objectContaining({ id: 'e2e-open', dday: 3 }), expect.anything()],
          totalCount: 2,
        },
        products: { items: [], totalCount: 0 },
      });
      expect(await searchIds('?q=lh')).toEqual(['e2e-nocoord', 'e2e-upcoming']);
      expect(await searchIds(`?q=${encodeURIComponent('도면 없는')}`)).toEqual([]);
    });

    it('제목 일치 → 앞부분 → 포함 → 다른 필드 순으로 세우고, 페이지를 나눠도 전체 건수는 따로 센다', async () => {
      const fixtures = [
        { id: 'e2e-rank-same', title: '매입임대' },
        { id: 'e2e-rank-prefix', title: '매입임대 2차' },
        { id: 'e2e-rank-field', title: '청년 주택', supplyType: '매입임대' },
      ];
      for (const fixture of fixtures) {
        await prisma.subscription.create({
          data: {
            ...fixture,
            agencyCode: 3,
            regionCode: 3,
            address: '경기도 성남시',
            floorplans: { create: [{ id: `${fixture.id}-a`, exclusiveArea: 20 }] },
          },
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
        await prisma.subscription.deleteMany({ where: { id: { startsWith: 'e2e-rank-' } } });
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
    // 오늘(9/8)을 기준으로 날짜 경계마다 한 건씩 — 상태 필터(SQL)와 응답의 statusCode(앱 계산)가 같은 규칙인지 본다
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
      { id: 'st-inverted-future', start: '2026-09-10', end: '2026-09-05', expected: 1 },
      { id: 'st-inverted-past', start: '2026-09-07', end: '2026-09-05', expected: 3 },
      { id: 'st-cancelled', start: '2026-09-07', end: '2026-09-11', cancelled: true, expected: 4 },
    ];

    beforeAll(async () => {
      for (const { id, start, end, cancelled } of BOUNDARY_CASES) {
        await prisma.subscription.create({
          data: {
            id,
            title: id,
            agencyCode: 1,
            regionCode: 1,
            address: '서울',
            applyStartDate: start ? day(start) : null,
            applyEndDate: end ? day(end) : null,
            cancelledAt: cancelled ? new Date('2026-09-02T00:00:00Z') : null,
            floorplans: { create: [{ id: `${id}-a`, exclusiveArea: 20 }] },
          },
        });
      }
    });

    afterAll(async () => {
      await prisma.subscription.deleteMany({ where: { id: { in: BOUNDARY_CASES.map((entry) => entry.id) } } });
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
      await prisma.subscription.create({
        data: {
          id: 'e2e-special',
          title: '당첨 100% \\ 특별공고',
          agencyCode: 4,
          regionCode: 2,
          address: '인천',
          floorplans: { create: [{ id: 'e2e-special-a', exclusiveArea: 18 }] },
        },
      });
      try {
        expect(await listIds('?keyword=%25')).toEqual(['e2e-special']);
        expect(await listIds('?keyword=%5C')).toEqual(['e2e-special']);
        expect(await listIds('?keyword=0%25')).toEqual(['e2e-special']);
        expect(await listIds('?keyword=_')).toEqual([]);
      } finally {
        await prisma.subscription.delete({ where: { id: 'e2e-special' } });
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
      expect(dataOf(response)).toMatchObject({ page: 1, pageSize: 20, totalCount: 3 });
      expect(listOf(response).items.map((item) => item.id)).toEqual(['e2e-open', 'e2e-nocoord', 'e2e-upcoming']);
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

  describe('공통', () => {
    it('정의서에 없는 기관 코드는 DB가 받지 않는다(ITF-001 1~4)', async () => {
      await expect(
        prisma.subscription.create({ data: { id: 'e2e-bad', title: 'x', agencyCode: 9, regionCode: 1, address: 'x' } }),
      ).rejects.toThrow(/subscriptions_agency_code_check/);
    });

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
