import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { Clock } from '../src/common/time/clock.js';
import { PrismaService } from '../src/database/prisma.service.js';

// 한국 9월 8일 정오 — 접수 기간(9/7~9/11) 한가운데다
const FIXED_NOW = new Date('2026-09-08T03:00:00Z');

describe('청약 공고 API (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

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
        applicationCount: 10,
        postDate: new Date('2026-09-01T00:00:00Z'),
        applyStartDate: new Date('2026-09-07T00:00:00Z'),
        applyEndDate: new Date('2026-09-11T00:00:00Z'),
        moveInMonth: '2027-03',
        applyUrl: 'https://www.i-sh.co.kr',
        units: {
          create: [
            { sizeType: '114', unitType: 'B', households: 4, price: null },
            { sizeType: '39', unitType: 'A', households: 20, price: '보증금 3,000만 원' },
          ],
        },
        floorplans: {
          create: [
            { id: 'e2e-open-b', sizeType: '39', image2dUrl: null, has3d: false, displayOrder: 1 },
            { id: 'e2e-open-a', sizeType: '39', image2dUrl: '/plans/a.png', has3d: true, displayOrder: 0 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.subscription.deleteMany();
    await app.close();
  });

  it('API-011 상세를 성공 엔벌로프로 돌려주고, 공고 상태는 한국 날짜로 계산한다', async () => {
    const response = await request(app.getHttpServer()).get('/api/subscriptions/e2e-open').expect(200);
    expect(response.body).toEqual({
      success: true,
      error: null,
      data: {
        id: 'e2e-open',
        title: '테스트 행복주택',
        agencyCode: 2,
        agencyName: '서울주택도시공사',
        statusCode: 2,
        region: 1,
        address: '서울특별시 중구 세종대로 110',
        lat: 37.5663,
        lng: 126.9779,
        postDate: '2026-09-01',
        applyStartDate: '2026-09-07',
        deadline: '2026-09-11',
        supplyType: '행복주택',
        households: 40,
        moveIn: '2027-03',
        competition: '2.5:1',
        // 주택형은 문자열이 아니라 숫자 크기순이다("114"가 "39"보다 뒤)
        units: [
          { size: '39', type: 'A', households: 20, price: '보증금 3,000만 원' },
          { size: '114', type: 'B', households: 4, price: null },
        ],
        applyUrl: 'https://www.i-sh.co.kr',
        floorplans: [
          { id: 'e2e-open-a', size: '39', type: null, has2d: true, has3d: true },
          { id: 'e2e-open-b', size: '39', type: null, has2d: false, has3d: false },
        ],
      },
    });
  });

  it('없는 공고·없는 경로는 ERR-008, 지나치게 긴 id는 ERR-005로 실패 엔벌로프를 준다', async () => {
    const missing = await request(app.getHttpServer()).get('/api/subscriptions/none').expect(404);
    expect(missing.body).toEqual({ success: false, data: null, error: { code: 'E009', message: 'NOT_FOUND' } });
    const noRoute = await request(app.getHttpServer()).get('/api/no-such-route').expect(404);
    expect(noRoute.body).toEqual({ success: false, data: null, error: { code: 'E009', message: 'NOT_FOUND' } });
    const invalid = await request(app.getHttpServer())
      .get(`/api/subscriptions/${'a'.repeat(101)}`)
      .expect(422);
    expect(invalid.body).toEqual({ success: false, data: null, error: { code: 'E006', message: 'VALIDATION_ERROR' } });
  });

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
