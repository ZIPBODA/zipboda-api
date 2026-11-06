/**
 * 개발용 단지·평면도. web이 쓰던 서울 LH 현황도 9개 단지 자료(zipboda-web/src/shared/api/housing-data + 3D 검수 목록)를
 * 옮긴 seed-data/complexes.json을 넣는다. 공고는 넣지 않는다 — LH 수집이 매입임대 공고의 건물 이름을 시드의
 * 확인된 별칭(MANUAL)으로 이 단지들에 잇는다(ERD §6). 평면도를 관리자 화면에서 올리게 되면(S4 API-122) 지운다.
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
import { addressKeyOf, nameKeyOf } from '../modules/subscription/complex-keys.js';
import { ComplexMatch, GeocodeStatus, NoticeSourceName } from '../modules/subscription/constants.js';
import { sizeTypeOf } from '../modules/subscription/size-type.js';
import { PrismaClient } from './generated/client.js';

const SEED_FILE = new URL('./seed-data/complexes.json', import.meta.url);

const seedSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    agency: z.enum(['LH', 'SH', 'GH', 'IH']),
    region: z.string().min(1),
    sigungu: z.string().min(1),
    address: z.string().min(1),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    households: z.number().int().nullable(),
    housingType: z.string().nullable(),
    imageUrl: z.string().nullable(),
    /**
     * 원천이 이 단지를 부르는 이름. 9곳 모두 LH '26년 3차 청년 매입임대' 공고의 건물 이름과 완전히 같다(2026-11-06 확인, ERD 미결 10).
     * 그 공고의 공급행은 시군구 없이 시도만 줘서 시군구를 비운 별칭이어야 수집기가 찾는다
     */
    aliases: z.array(
      z.object({ source: z.enum([NoticeSourceName.LH]), name: z.string().min(1), sigungu: z.string().default('') }),
    ),
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
  const complexes = seedSchema.parse(JSON.parse(readFileSync(SEED_FILE, 'utf8')));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    for (const complex of complexes) {
      const agencyCode = AgencyCode[complex.agency];
      const regionCode = regionCodeOf(complex.region);
      const data = {
        agencyCode,
        regionCode,
        name: complex.name,
        sigungu: complex.sigungu,
        address: complex.address,
        addressKey: addressKeyOf(complex.address),
        lat: complex.lat,
        lng: complex.lng,
        geocodeStatus: complex.lat === null || complex.lng === null ? GeocodeStatus.NOT_FOUND : GeocodeStatus.OK,
        households: complex.households,
        housingType: complex.housingType,
        imageUrl: complex.imageUrl,
      };
      const floorplans = complex.floorplans.map((plan, order) => ({
        id: plan.id,
        complexId: complex.id,
        floor: plan.floor,
        unitNumber: plan.unitNumber,
        unitType: plan.unitType,
        exclusiveArea: plan.exclusiveArea,
        sizeType: plan.exclusiveArea === null ? null : sizeTypeOf(plan.exclusiveArea),
        image2dUrl: plan.image2dUrl,
        has3d: plan.has3d,
        displayOrder: order,
      }));
      const aliasKeys = complex.aliases.map((alias) => ({
        source: alias.source,
        agencyCode,
        regionCode,
        sigungu: alias.sigungu,
        nameKey: nameKeyOf(alias.name),
      }));
      // 몇 번을 돌려도 같은 결과가 되게 단지·별칭은 덮어쓰고 도면은 갈아 끼운다. 별칭은 지우지 않는다 — 수집이 먼저 만든
      // 같은 이름의 NAME 별칭은 시드가 확인한 MANUAL로 바꾸고, 관리자가 단 다른 별칭은 남긴다
      await prisma.$transaction([
        prisma.complex.upsert({ where: { id: complex.id }, create: { id: complex.id, ...data }, update: data }),
        ...aliasKeys.map((key) =>
          prisma.complexAlias.upsert({
            where: { source_agencyCode_regionCode_sigungu_nameKey: key },
            create: { ...key, complexId: complex.id, method: ComplexMatch.MANUAL },
            update: { complexId: complex.id, method: ComplexMatch.MANUAL },
          }),
        ),
        prisma.floorplan.deleteMany({ where: { complexId: complex.id } }),
        prisma.floorplan.createMany({ data: floorplans }),
      ]);
    }
    console.log(
      `시드 완료: 단지 ${complexes.length}곳, 도면 ${complexes.reduce((sum, item) => sum + item.floorplans.length, 0)}건`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

await main();
