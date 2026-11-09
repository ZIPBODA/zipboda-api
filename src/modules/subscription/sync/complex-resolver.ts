import type { StoredAgencyCode, StoredRegionCode } from '@/common/constants/interface-codes.js';
import type { Prisma } from '@/database/generated/client.js';
import { ComplexMatch, GeocodeStatus, SyncStage, type NoticeSourceName } from '../constants.js';
import type { NormalizedComplex, Warn } from './normalized-notice.js';

export interface ResolvedComplex {
  complexId: string;
  complexMatch: ComplexMatch;
}

export interface ComplexContext {
  source: NoticeSourceName;
  agencyCode: StoredAgencyCode;
  regionCode: StoredRegionCode;
}

const aliasKeyOf = (complex: NormalizedComplex, context: ComplexContext) => ({
  source: context.source,
  agencyCode: context.agencyCode,
  regionCode: context.regionCode,
  sigungu: complex.sigungu ?? '',
  nameKey: complex.nameKey,
});

/** 이 단지를 찾거나 만들 때 겹칠 수 있는 키 — 트랜잭션 잠금(lockKeys)에 쓴다 */
export const complexLockKeysOf = (complex: NormalizedComplex, context: ComplexContext): string[] => {
  const alias = aliasKeyOf(complex, context);
  return [
    `complex-alias:${alias.source}:${alias.agencyCode}:${alias.regionCode}:${alias.sigungu}:${alias.nameKey}`,
    ...(complex.addressKey === null ? [] : [`complex-address:${context.agencyCode}:${complex.addressKey}`]),
    ...(complex.address === null ? [] : [`complex-address-text:${context.agencyCode}:${complex.address}`]),
  ];
};

type ExistingComplex = Prisma.ComplexGetPayload<{
  select: { id: true; sigungu: true; households: true; areaMin: true; areaMax: true; imageUrl: true };
}>;

const EXISTING_SELECT = {
  id: true,
  sigungu: true,
  households: true,
  areaMin: true,
  areaMax: true,
  imageUrl: true,
} satisfies Prisma.ComplexSelect;

const createComplex = (tx: Prisma.TransactionClient, complex: NormalizedComplex, context: ComplexContext) =>
  tx.complex.create({
    data: {
      agencyCode: context.agencyCode,
      regionCode: context.regionCode,
      name: complex.name,
      sigungu: complex.sigungu,
      address: complex.address,
      addressKey: complex.addressKey,
      // 주소가 있으면 지오코딩을 기다린다(null), 없으면 좌표를 얻을 길이 없다
      geocodeStatus: complex.address === null ? GeocodeStatus.NO_ADDRESS : null,
      households: complex.households,
      areaMin: complex.areaMin,
      areaMax: complex.areaMax,
      imageUrl: complex.imageUrl,
    },
    select: EXISTING_SELECT,
  });

/**
 * 이미 있는 단지는 비어 있는 값만 채운다 — 시드·관리자가 넣은 값이나 다른 공고가 채운 값을 덮어쓰지 않는다.
 * 주소·판별 키는 건드리지 않는다(다른 단지와 키가 겹칠 수 있어 판별 규칙으로만 정한다)
 */
const fillMissing = async (tx: Prisma.TransactionClient, existing: ExistingComplex, complex: NormalizedComplex) => {
  const fillAreaRange =
    existing.areaMin === null && existing.areaMax === null && complex.areaMin !== null && complex.areaMax !== null;
  const data = {
    ...(existing.sigungu === null && complex.sigungu !== null ? { sigungu: complex.sigungu } : {}),
    ...(existing.households === null && complex.households !== null ? { households: complex.households } : {}),
    ...(existing.imageUrl === null && complex.imageUrl !== null ? { imageUrl: complex.imageUrl } : {}),
    ...(fillAreaRange ? { areaMin: complex.areaMin, areaMax: complex.areaMax } : {}),
  };
  if (Object.keys(data).length > 0) await tx.complex.update({ where: { id: existing.id }, data });
};

/**
 * 칸의 단지를 정한다(ERD §5 규칙 8) — ① 주소 판별 키가 같은 기관 단지, 없으면 새로 만든다(ADDRESS).
 * ② 주소가 없으면 별칭(원천·기관·지역·시군구·이름)으로 찾는다(MANUAL 별칭이면 MANUAL, 아니면 NAME).
 * ③ 별칭도 없으면 새 단지와 별칭(NAME)을 만든다. 주소 없는 이름으로는 주소가 있는 기존 단지에 자동으로 잇지 않는다.
 * 부르는 쪽이 complexLockKeysOf의 키를 먼저 잠근다
 */
export const resolveComplex = async (
  tx: Prisma.TransactionClient,
  complex: NormalizedComplex,
  context: ComplexContext,
  warn: Warn,
): Promise<ResolvedComplex> => {
  const aliasKey = aliasKeyOf(complex, context);
  // 별칭으로 남기지 않는 이름(일반명·주소에서 지어낸 이름)은 주소가 있어야 다시 찾을 수 있다 — 정규화가 주소 없는 일반명은
  // 공고 단위 칸으로 보낸다. 이 약속이 깨지면 다시 받을 때마다 단지가 새로 생겨 조용히 넘기지 않는다
  if (!complex.aliasable && complex.address === null) {
    throw new Error(`별칭을 남기지 않는 이름인데 주소가 없습니다: ${complex.name}`);
  }
  // 판별 키를 못 만든 호별 주소(블록 주소 등)에서 지어낸 이름은 별칭으로 남기지 않는다 — 같은 이름의 다른 건물이 붙지 않게
  // 주소 원문이 같은 단지로만 찾는다
  if (complex.addressKey === null && !complex.aliasable && complex.address !== null) {
    const found = await tx.complex.findFirst({
      where: { agencyCode: context.agencyCode, address: complex.address },
      select: EXISTING_SELECT,
    });
    if (found) await fillMissing(tx, found, complex);
    const target = found ?? (await createComplex(tx, complex, context));
    return { complexId: target.id, complexMatch: ComplexMatch.ADDRESS };
  }
  if (complex.addressKey !== null) {
    const found = await tx.complex.findFirst({
      where: { agencyCode: context.agencyCode, addressKey: complex.addressKey },
      select: EXISTING_SELECT,
    });
    const target = found ?? (await createComplex(tx, complex, context));
    if (found) await fillMissing(tx, found, complex);
    if (complex.aliasable) {
      const alias = await tx.complexAlias.findUnique({ where: { source_agencyCode_regionCode_sigungu_nameKey: aliasKey } });
      if (alias === null) {
        await tx.complexAlias.create({ data: { ...aliasKey, complexId: target.id, method: ComplexMatch.ADDRESS } });
      } else if (alias.complexId !== target.id) {
        warn(
          SyncStage.MATCH,
          'ALIAS_ADDRESS_CONFLICT',
          `이름 '${complex.name}'의 별칭은 다른 단지를 가리키지만 주소로 판별한 단지를 썼다(별칭은 그대로 둠)`,
        );
      }
    }
    return { complexId: target.id, complexMatch: ComplexMatch.ADDRESS };
  }

  const alias = await tx.complexAlias.findUnique({ where: { source_agencyCode_regionCode_sigungu_nameKey: aliasKey } });
  if (alias !== null) {
    const existing = await tx.complex.findUniqueOrThrow({ where: { id: alias.complexId }, select: EXISTING_SELECT });
    await fillMissing(tx, existing, complex);
    return {
      complexId: alias.complexId,
      complexMatch: alias.method === ComplexMatch.MANUAL ? ComplexMatch.MANUAL : ComplexMatch.NAME,
    };
  }
  const created = await createComplex(tx, complex, context);
  await tx.complexAlias.create({ data: { ...aliasKey, complexId: created.id, method: ComplexMatch.NAME } });
  return { complexId: created.id, complexMatch: ComplexMatch.NAME };
};
