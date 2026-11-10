import { Prisma } from '@/database/generated/client.js';
import { COMPLEX_MATCH_STRENGTH, SyncStage, type ComplexMatch } from '../constants.js';
import { addCounts } from './counts.js';
import { dateOf, timeOf } from './db-values.js';
import { summaryOf } from './listing-summary.js';
import type { NormalizedListing, NormalizedSchedule, NormalizedUnit, Warn } from './normalized-notice.js';

/** 단지를 정한 칸. complexId가 null이면 공고 단위 칸이다 */
export interface ResolvedListing {
  complexId: string | null;
  complexMatch: ComplexMatch | null;
  listing: NormalizedListing;
}

/**
 * exclusive_area는 DECIMAL(9,4)라 DB가 넷째 자리로 반올림(0.5는 올림)한다. 저장 전 값과 비교해도 같은 주택형으로 보게
 * 같은 규칙으로 맞춘다 — 부동소수 toFixed는 16.12345를 16.1234로 내려 DB 값(16.1235)과 어긋난다
 */
const AREA_SCALE = 4;

const scheduleKeyOf = (schedule: NormalizedSchedule): string => JSON.stringify(schedule);

const strongerMatch = (a: ComplexMatch | null, b: ComplexMatch | null): ComplexMatch | null => {
  if (a === null) return b;
  if (b === null) return a;
  return COMPLEX_MATCH_STRENGTH[a] >= COMPLEX_MATCH_STRENGTH[b] ? a : b;
};

/** 두 칸이 모두 신청 인원을 알 때만 더한다 — 한쪽이라도 모르면 합계도 모른다(일부만 더하면 경쟁률이 낮게 나온다) */
const mergeApplicationCounts = (
  a: number | null | undefined,
  b: number | null | undefined,
): number | null | undefined => {
  if (a === undefined && b === undefined) return undefined;
  if (a === undefined || a === null || b === undefined || b === null) return null;
  return a + b;
};

/** 신청 인원은 그 값을 정하는 원천(청약홈, ERD §5 규칙 12)이 준 때만 쓴다 — 다른 원천이 다시 써도 청약홈 값을 지우지 않게 */
const applicationCountData = (applicationCount: number | null | undefined) =>
  applicationCount === undefined ? {} : { applicationCount };

/**
 * 같은 단지로 판별된 칸을 하나로 합친다 — UNIQUE(notice_id, complex_id)(ERD §5 규칙 8). 공고 전체 일정이 칸마다 들어 있어
 * 같은 일정은 한 번만 남기고, 확인된 연결(평면도 노출)을 남긴다
 */
export const mergeByComplex = (resolved: ResolvedListing[], warn: Warn): ResolvedListing[] => {
  const merged = new Map<string | null, ResolvedListing>();
  for (const entry of resolved) {
    const existing = merged.get(entry.complexId);
    if (existing === undefined) {
      merged.set(entry.complexId, entry);
      continue;
    }
    warn(
      SyncStage.MATCH,
      'LISTINGS_MERGED',
      `같은 단지로 판별된 칸을 합쳤다: ${entry.listing.complex?.name ?? '공고 단위 칸'}`,
    );
    const a = existing.listing;
    const b = entry.listing;
    const schedules = [...new Map([...a.schedules, ...b.schedules].map((s) => [scheduleKeyOf(s), s])).values()];
    merged.set(entry.complexId, {
      complexId: entry.complexId,
      complexMatch: strongerMatch(existing.complexMatch, entry.complexMatch),
      listing: {
        ...a,
        moveInMonth: a.moveInMonth ?? b.moveInMonth,
        supplyNote: a.supplyNote ?? b.supplyNote,
        supplyUnits: addCounts(a.supplyUnits, b.supplyUnits),
        recruitCount: addCounts(a.recruitCount, b.recruitCount),
        applicationCount: mergeApplicationCounts(a.applicationCount, b.applicationCount),
        units: [...a.units, ...b.units],
        schedules,
        summary: summaryOf(schedules, warn),
      },
    });
  }
  return [...merged.values()];
};

/** 원천이 바꾸지 않는 한 같은 주택형으로 본다 — 청약홈이 채운 신청 인원을 다시 수집해도 잃지 않게 행을 갈아 끼우지 않는다 */
const unitKeyOf = (unit: {
  label: string | null;
  exclusiveArea: { toString(): string } | number | null;
  unitNumber: string | null;
}) =>
  [
    unit.label ?? '',
    unit.exclusiveArea === null
      ? ''
      : new Prisma.Decimal(unit.exclusiveArea.toString())
          .toDecimalPlaces(AREA_SCALE, Prisma.Decimal.ROUND_HALF_UP)
          .toFixed(AREA_SCALE),
    unit.unitNumber ?? '',
  ].join('|');

const unitDataOf = (unit: NormalizedUnit, displayOrder: number) => ({
  label: unit.label,
  sizeType: unit.sizeType,
  unitType: unit.unitType,
  exclusiveArea: unit.exclusiveArea,
  areaMin: unit.areaMin,
  areaMax: unit.areaMax,
  supplyArea: unit.supplyArea,
  unitNumber: unit.unitNumber,
  floorLabel: unit.floorLabel,
  totalHouseholds: unit.totalHouseholds,
  supplyHouseholds: unit.supplyHouseholds,
  recruitCount: unit.recruitCount,
  depositWon: unit.depositWon,
  monthlyRentWon: unit.monthlyRentWon,
  salePriceWon: unit.salePriceWon,
  priceNote: unit.priceNote,
  note: unit.note,
  ...applicationCountData(unit.applicationCount),
  displayOrder,
});

/** 주택형은 같은 주택형끼리 고치고, 새 주택형은 더하고, 사라진 주택형만 지운다(ERD §5 규칙 13) */
const writeUnits = async (tx: Prisma.TransactionClient, subscriptionId: string, units: NormalizedUnit[]) => {
  const existing = await tx.subscriptionUnit.findMany({
    where: { subscriptionId },
    select: { id: true, label: true, exclusiveArea: true, unitNumber: true },
  });
  const unmatched = new Map<string, string[]>();
  for (const row of existing) unmatched.set(unitKeyOf(row), [...(unmatched.get(unitKeyOf(row)) ?? []), row.id]);
  const toCreate: Prisma.SubscriptionUnitCreateManyInput[] = [];
  for (const [order, unit] of units.entries()) {
    const id = unmatched.get(unitKeyOf(unit))?.shift();
    if (id === undefined) toCreate.push({ subscriptionId, ...unitDataOf(unit, order) });
    else await tx.subscriptionUnit.update({ where: { id }, data: unitDataOf(unit, order) });
  }
  const leftover = [...unmatched.values()].flat();
  if (leftover.length > 0) await tx.subscriptionUnit.deleteMany({ where: { id: { in: leftover } } });
  if (toCreate.length > 0) await tx.subscriptionUnit.createMany({ data: toCreate });
};

const writeSchedules = async (
  tx: Prisma.TransactionClient,
  subscriptionId: string,
  schedules: NormalizedSchedule[],
) => {
  await tx.subscriptionSchedule.deleteMany({ where: { subscriptionId } });
  if (schedules.length === 0) return;
  await tx.subscriptionSchedule.createMany({
    data: schedules.map((schedule, sortOrder) => ({
      subscriptionId,
      kind: schedule.kind,
      label: schedule.label,
      startDate: dateOf(schedule.startDate),
      endDate: dateOf(schedule.endDate),
      startTime: timeOf(schedule.startTime),
      endTime: timeOf(schedule.endTime),
      note: schedule.note,
      sortOrder,
    })),
  });
};

const subscriptionDataOf = ({ complexMatch, listing }: ResolvedListing) => ({
  complexMatch,
  regionCode: listing.regionCode,
  applyStartDate: dateOf(listing.summary.applyStartDate),
  applyEndDate: dateOf(listing.summary.applyEndDate),
  winnerDate: dateOf(listing.summary.winnerDate),
  contractStartDate: dateOf(listing.summary.contractStartDate),
  contractEndDate: dateOf(listing.summary.contractEndDate),
  moveInMonth: listing.moveInMonth,
  supplyUnits: listing.supplyUnits,
  recruitCount: listing.recruitCount,
  supplyNote: listing.supplyNote,
  ...applicationCountData(listing.applicationCount),
});

/**
 * 공고의 칸을 원천대로 맞춘다. 같은 단지의 칸은 id를 그대로 두어(관심·알림이 가리킨다) 값만 바꾸고, 원천에서 사라진 단지의 칸은
 * 지운다(ERD §5 규칙 13). 칸 수는 공고마다 수십~백여 개라 칸마다 따로 쓴다
 */
export const writeSubscriptions = async (
  tx: Prisma.TransactionClient,
  noticeId: string,
  resolved: ResolvedListing[],
): Promise<string[]> => {
  const existing = await tx.subscription.findMany({ where: { noticeId }, select: { id: true, complexId: true } });
  const idByComplex = new Map(existing.map((row) => [row.complexId, row.id]));
  const keptIds: string[] = [];
  for (const entry of resolved) {
    const data = subscriptionDataOf(entry);
    const existingId = idByComplex.get(entry.complexId);
    const id =
      existingId === undefined
        ? (
            await tx.subscription.create({
              data: { noticeId, complexId: entry.complexId, ...data },
              select: { id: true },
            })
          ).id
        : (await tx.subscription.update({ where: { id: existingId }, data, select: { id: true } })).id;
    keptIds.push(id);
    await writeSchedules(tx, id, entry.listing.schedules);
    await writeUnits(tx, id, entry.listing.units);
  }
  await tx.subscription.deleteMany({ where: { noticeId, id: { notIn: keptIds } } });
  return keptIds;
};
