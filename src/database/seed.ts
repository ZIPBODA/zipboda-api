/**
 * 공공데이터 연계(API-114) 전까지 쓸 개발용 데이터. web이 쓰던 서울 LH 현황도 9개 단지 자료
 * (zipboda-web/src/shared/api/housing-data + 3D 검수 목록)를 옮긴 seed-data/subscriptions.json을 넣는다.
 * 연계가 들어오는 PR에서 이 시드와 seed-data를 함께 지운다(backend.rule A1).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import {
  AgencyCode,
  isStoredRegionCode,
  REGION_NAME,
  type StoredRegionCode,
} from '../common/constants/interface-codes.js';
import { sizeTypeOf } from '../modules/subscription/size-type.js';
import { PrismaClient } from './generated/client.js';

const SEED_FILE = new URL('./seed-data/subscriptions.json', import.meta.url);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const seedSchema = z.array(
  z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    agency: z.enum(['LH', 'SH', 'GH', 'IH']),
    region: z.string().min(1),
    address: z.string().min(1),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    supplyType: z.string().nullable(),
    households: z.number().int().nullable(),
    imageUrl: z.string().nullable(),
    notice: z
      .object({
        postDate: isoDate,
        applyStartDate: isoDate,
        applyEndDate: isoDate,
        contractDate: isoDate,
        moveInMonth: z.string().regex(/^\d{4}-\d{2}$/),
        supplyUnits: z.number().int(),
        recruitCount: z.number().int(),
        applicationCount: z.number().int(),
        applyUrl: z.url(),
      })
      .nullable(),
    floorplans: z.array(
      z.object({
        id: z.string().min(1),
        floor: z.string().nullable(),
        unitNumber: z.string().nullable(),
        unitType: z.string().nullable(),
        exclusiveArea: z.number().nullable(),
        image2dUrl: z.string().nullable(),
        has3d: z.boolean(),
      }),
    ),
  }),
);

const regionCodeOf = (name: string): StoredRegionCode => {
  const code = Object.keys(REGION_NAME)
    .map(Number)
    .find((candidate) => isStoredRegionCode(candidate) && REGION_NAME[candidate] === name);
  if (code === undefined || !isStoredRegionCode(code)) throw new Error(`지역 코드(ITF-004)에 없는 지역: ${name}`);
  return code;
};

const dateOf = (isoDateText: string | undefined): Date | null =>
  isoDateText ? new Date(`${isoDateText}T00:00:00Z`) : null;

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 개발용 자료라 실제 데이터가 있는 DB에 섞이면 안 된다. NODE_ENV만으로는 개발 PC의 .env가 development로 채워
 * 운영 주소를 막지 못하므로 주소의 호스트도 본다. 주소가 없으면 드라이버 기본값(localhost:5432)의 엉뚱한 DB에 붙는다
 */
const seedDatabaseUrl = (): string => {
  if (process.env.NODE_ENV === 'production') throw new Error('개발용 시드는 운영 환경에서 실행하지 않습니다');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL이 없습니다. .env.example을 참고해 설정하세요.');
  const { hostname } = new URL(url);
  if (!LOCAL_DATABASE_HOSTS.has(hostname) && process.env.SEED_ALLOW_REMOTE_DATABASE !== 'true') {
    throw new Error(
      `로컬이 아닌 DB(${hostname})에는 시드를 넣지 않습니다. 일부러 넣으려면 SEED_ALLOW_REMOTE_DATABASE=true`,
    );
  }
  return url;
};

async function main(): Promise<void> {
  const connectionString = seedDatabaseUrl();
  const subscriptions = seedSchema.parse(JSON.parse(readFileSync(SEED_FILE, 'utf8')));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    for (const subscription of subscriptions) {
      const { notice } = subscription;
      const data = {
        title: subscription.title,
        agencyCode: AgencyCode[subscription.agency],
        regionCode: regionCodeOf(subscription.region),
        address: subscription.address,
        lat: subscription.lat,
        lng: subscription.lng,
        supplyType: subscription.supplyType,
        households: subscription.households,
        imageUrl: subscription.imageUrl,
        postDate: dateOf(notice?.postDate),
        applyStartDate: dateOf(notice?.applyStartDate),
        applyEndDate: dateOf(notice?.applyEndDate),
        contractDate: dateOf(notice?.contractDate),
        moveInMonth: notice?.moveInMonth ?? null,
        supplyUnits: notice?.supplyUnits ?? null,
        recruitCount: notice?.recruitCount ?? null,
        applicationCount: notice?.applicationCount ?? null,
        applyUrl: notice?.applyUrl ?? null,
      };
      const floorplans = subscription.floorplans.map((plan, order) => ({
        id: plan.id,
        floor: plan.floor,
        unitNumber: plan.unitNumber,
        unitType: plan.unitType,
        exclusiveArea: plan.exclusiveArea,
        sizeType: plan.exclusiveArea === null ? null : sizeTypeOf(plan.exclusiveArea),
        image2dUrl: plan.image2dUrl,
        has3d: plan.has3d,
        displayOrder: order,
      }));
      // 몇 번을 돌려도 같은 결과가 되게 공고는 덮어쓰고 도면은 갈아 끼운다
      await prisma.$transaction([
        prisma.subscription.upsert({
          where: { id: subscription.id },
          create: { id: subscription.id, ...data },
          update: data,
        }),
        prisma.floorplan.deleteMany({ where: { subscriptionId: subscription.id } }),
        prisma.floorplan.createMany({ data: floorplans.map((plan) => ({ ...plan, subscriptionId: subscription.id })) }),
      ]);
    }
    console.log(
      `시드 완료: 공고 ${subscriptions.length}건, 도면 ${subscriptions.reduce((sum, item) => sum + item.floorplans.length, 0)}건`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
