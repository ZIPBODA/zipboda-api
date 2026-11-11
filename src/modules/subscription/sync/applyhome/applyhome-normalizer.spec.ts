import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AgencyCode, RegionCode } from '@/common/constants/interface-codes.js';
import { ScheduleKind, SupplyCategory, SyncStage } from '../../constants.js';
import type { NormalizedNotice, NormalizeResult } from '../normalized-notice.js';
import { agencyOf } from './applyhome-classify.js';
import { normalizeApplyhomeNotice } from './applyhome-normalizer.js';
import { applyhomeBundleOf, type ApplyhomeBundle } from './applyhome-raw.js';

// 2026-11-10 청약홈 API에서 받은 실제 응답(상세·주택형·경쟁률) — test/fixtures/applyhome
const fixtureText = (name: string) =>
  readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'applyhome', `${name}.json`), 'utf8');

/** 원문 일부를 바꿔 경계 사례를 만든다 — 응답 모양은 그대로 둔 채 값만 고친다 */
const bundleOf = (name: string, edits: [string, string][] = []): ApplyhomeBundle => {
  const text = edits.reduce((current, [from, to]) => {
    if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
    return current.replaceAll(from, to);
  }, fixtureText(name));
  return applyhomeBundleOf(JSON.parse(text));
};

const normalize = (name: string, edits: [string, string][] = []): NormalizeResult =>
  normalizeApplyhomeNotice(bundleOf(name, edits));

const noticeOf = (result: NormalizeResult): NormalizedNotice => {
  if (result.kind !== 'notice') throw new Error(`공고가 아니라 ${result.kind}로 나왔습니다`);
  return result.notice;
};

describe('청약홈 공고 정규화', () => {
  describe('사업주체로 공급기관 가르기(ERD §5 규칙 18)', () => {
    it.each([
      ['한국토지주택공사', AgencyCode.LH],
      ['한국토지주택공사 경기남부지역본부', AgencyCode.LH],
      ['한국토지주택공사경기남부지역본부', AgencyCode.LH],
      ['한국토지주택공사 세종특별본부', AgencyCode.LH],
      ['한국토지주택공사, 우미건설(주),신동아건설(주)', AgencyCode.LH],
      ['(주)대우건설/한국토지주택공사', AgencyCode.LH],
      ['서울주택도시개발공사', AgencyCode.SH],
      ['경기주택도시공사', AgencyCode.GH],
      ['인천도시공사,(주)대우건설,동부건설(주)', AgencyCode.IH],
    ])('%s → %s', (name, agency) => {
      expect(agencyOf(name)).toBe(agency);
    });

    it.each([
      ['부천역곡대림A경기도시공사참여가로주택정비사업조합'],
      ['경기주택도시공사참여 가로주택정비사업조합'],
      ['부산도시공사'],
      ['신한자산신탁 주식회사'],
      [''],
    ])('공공 4기관의 사업이 아니면 기관이 없다: %s', (name) => {
      expect(agencyOf(name)).toBeNull();
    });

    it.each([['apt-private-builder'], ['pblpvt-private']])('%s는 수집 범위 밖이다', (name) => {
      expect(normalize(name)).toEqual({
        kind: 'excluded',
        reason: '사업주체가 공공 4기관(LH·SH·GH·iH)이 아니다',
        warnings: [],
      });
    });

    it('수집 지역 밖(울산) 공고는 주택형 응답이 비거나 분류표 밖이어도 수집 범위 밖이다 — 오류·경고로 남기지 않는다', () => {
      const outside = { kind: 'excluded', reason: '수집 지역(서울·인천·경기) 밖 공고', warnings: [] };
      expect(normalize('apt-lh-outside-region')).toEqual(outside);
      expect(normalizeApplyhomeNotice({ ...bundleOf('apt-lh-outside-region'), models: [] })).toEqual(outside);
      expect(normalize('apt-lh-outside-region', [['"RENT_SECD": "0"', '"RENT_SECD": "2"']])).toEqual(outside);
    });

    it('분류표에 없는 구분은 저장하지 않고 경고로 남긴다', () => {
      expect(normalize('urbty-lh-officetel', [['"HOUSE_DTL_SECD": "02"', '"HOUSE_DTL_SECD": "04"']])).toEqual({
        kind: 'unclassified',
        warning: {
          stage: SyncStage.NORMALIZE,
          code: 'UNCLASSIFIED_TYPE',
          message: '분류표에 없는 청약홈 유형 URBTY-04(오피스텔)',
        },
      });
    });
  });

  describe('공고', () => {
    it('APT 공공분양: 원천 키·기관·분류·게시일·청약홈 링크, 정정 표시는 없다', () => {
      const notice = noticeOf(normalize('apt-lh-public-sale'));
      expect(notice).toMatchObject({
        source: 'APPLYHOME',
        sourceKey: '2026000531:2026000531',
        sourceParams: { KIND: 'APT', HOUSE_MANAGE_NO: '2026000531', PBLANC_NO: '2026000531' },
        agencyCode: AgencyCode.LH,
        title: '시흥거모지구 S-1블록 공공분양(본청약)',
        titleKey: '시흥거모지구 S-1블록 공공분양(본청약)',
        correctionMarks: 0,
        supplyCategory: SupplyCategory.SALE,
        supplyType: 'APT·국민·분양주택',
        postDate: '2026-10-23',
        sourceStatus: null,
        attachments: [],
        warnings: [],
      });
      expect(notice.applyUrl).toContain('houseManageNo=2026000531');
    });

    it.each([
      ['apt-sh-land-lease', AgencyCode.SH, RegionCode.SEOUL],
      ['apt-gh-private', AgencyCode.GH, RegionCode.GYEONGGI],
      ['apt-ih-consortium', AgencyCode.IH, RegionCode.INCHEON],
      ['remndr-lh-consortium', AgencyCode.LH, RegionCode.INCHEON],
    ])('%s: 기관 %s·지역 %s', (name, agencyCode, regionCode) => {
      const notice = noticeOf(normalize(name));
      expect(notice.agencyCode).toBe(agencyCode);
      expect(notice.listings[0].regionCode).toBe(regionCode);
    });

    it('임의공급의 YYYYMMDD 날짜도 읽는다', () => {
      const notice = noticeOf(normalize('opt-lh'));
      expect(notice).toMatchObject({ supplyType: '임의공급', postDate: '2026-09-07' });
      expect(notice.listings[0].summary).toEqual({
        applyStartDate: '2026-09-09',
        applyEndDate: '2026-09-14',
        winnerDate: '2026-09-17',
        contractStartDate: '2026-09-19',
        contractEndDate: '2026-09-19',
      });
    });
  });

  describe('분양전환 가능 임대(6년 공공임대)', () => {
    it('LH와 같은 공공임대로 분류하고, 최고 금액 열은 분양가가 아니라 임대보증금으로 담는다', () => {
      const notice = noticeOf(normalize('apt-lh-convertible-rental'));
      expect(notice).toMatchObject({
        supplyCategory: SupplyCategory.PUBLIC_RENTAL,
        supplyType: 'APT·국민·분양전환 가능임대',
      });
      // 같은 공고 LH 공급정보(test/fixtures/lh/public-rental-6y.json)의 보증금 LS_GMY 85,614,000원을 만원 단위로 내린 값
      expect(notice.listings[0].units[0]).toMatchObject({
        label: '55.0000A',
        depositWon: 85_610_000n,
        salePriceWon: null,
      });
    });
  });

  describe('단지(칸 하나)', () => {
    it('공급 위치로 판별 키를 만들고, 공고명 끝의 회차·국민/민영 표시는 단지 이름에서 뗀다', () => {
      const [listing] = noticeOf(normalize('remndr-gh-national')).listings;
      expect(listing.complex).toEqual({
        name: '고덕 자연앤 하우스디(A4BL)',
        nameKey: '고덕 자연앤 하우스디(A4BL)',
        aliasable: true,
        sigungu: '평택시',
        address: '경기도 평택시 고덕동 1858-2번지(고덕국제화계획지구 A4BL)',
        addressKey: '경기도 평택시 고덕동 1858-2',
        households: null,
        areaMin: null,
        areaMax: null,
        imageUrl: null,
      });
    });

    it('블록 주소는 판별 키가 없어 이름으로 찾는다 — 같은 사업의 n차 공고가 같은 단지 이름이다', () => {
      const [listing] = noticeOf(normalize('opt-lh')).listings;
      expect(listing.complex).toMatchObject({ name: '고덕신도시 아테라 A-63블록 공공분양주택', addressKey: null });
      const [secondRound] = noticeOf(
        normalize('opt-lh', [
          ['고덕신도시 아테라 A-63블록 공공분양주택', '고덕신도시 아테라 A-63블록 공공분양주택(2차)'],
        ]),
      ).listings;
      expect(secondRound.complex?.nameKey).toBe(listing.complex?.nameKey);
    });

    it('회차 표시뿐인 공고명은 단지 이름이 비지 않게 그대로 쓴다', () => {
      const [listing] = noticeOf(normalize('remndr-lh-consortium', [['용현자이 크레스트(2차)', '(2차)']])).listings;
      expect(listing.complex?.name).toBe('(2차)');
    });

    it('같은 주소의 공공분양·지분적립형 공고는 같은 판별 키다', () => {
      const keyOf = (name: string) => noticeOf(normalize(name)).listings[0].complex?.addressKey;
      expect(keyOf('apt-gh-public-sale')).toBe('경기도 수원시 영통구 원천동 633');
      expect(keyOf('apt-gh-shared-equity')).toBe(keyOf('apt-gh-public-sale'));
    });

    it('칸의 공급 세대는 주택형(일반 + 특별공급) 합이다 — 단지 공급규모(TOT_SUPLY_HSHLDCO 300)가 아니다', () => {
      const [listing] = noticeOf(normalize('apt-lh-public-sale')).listings;
      expect(listing).toMatchObject({ moveInMonth: '2029-06', supplyUnits: 105, recruitCount: null });
    });
  });

  describe('주택형', () => {
    it('주택형 표기의 앞 0을 떼고 전용면적·타입을 읽으며, 분양가는 만원 → 원이다', () => {
      const [first] = noticeOf(normalize('apt-lh-public-sale')).listings[0].units;
      expect(first).toEqual({
        label: '59.9000A',
        sizeType: '59',
        unitType: 'A',
        exclusiveArea: 59.9,
        areaMin: null,
        areaMax: null,
        supplyArea: 78.7184,
        unitNumber: null,
        floorLabel: null,
        totalHouseholds: null,
        supplyHouseholds: 13,
        recruitCount: null,
        depositWon: null,
        monthlyRentWon: null,
        salePriceWon: 411_100_000n,
        priceNote: null,
        note: null,
      });
    });

    it('타입에 숫자가 붙은 주택형("059.9700A1")도 읽는다', () => {
      const notice = noticeOf(
        normalize('remndr-lh-consortium', [['"HOUSE_TY": "059.9700A"', '"HOUSE_TY": "059.9700A1"']]),
      );
      expect(notice.listings[0].units[0]).toMatchObject({ label: '59.9700A1', unitType: 'A1', exclusiveArea: 59.97 });
    });

    it('쉼표가 붙은 금액도 원으로 바꾼다', () => {
      const [first] = noticeOf(normalize('opt-lh')).listings[0].units;
      expect(first).toMatchObject({ label: '74.5900A', salePriceWon: 475_520_000n, supplyHouseholds: 13 });
    });

    it('오피스텔은 타입과 전용면적 열을 따로 읽는다', () => {
      const [first] = noticeOf(normalize('urbty-lh-officetel')).listings[0].units;
      expect(first).toMatchObject({
        label: '34OA',
        unitType: 'OA',
        exclusiveArea: 34.57,
        sizeType: '34',
        supplyHouseholds: 72,
        salePriceWon: 242_990_000n,
      });
    });

    it('금액이 숫자가 아니거나 원으로 바꿔 BIGINT를 넘으면 비우고 안내로 남기며, 읽지 못한 주택형은 경고한다', () => {
      const notice = noticeOf(
        normalize('remndr-gh-national', [
          ['"LTTOT_TOP_AMOUNT": "49520"', '"LTTOT_TOP_AMOUNT": "공고문 참조"'],
          ['"HOUSE_TY": "084.8325B"', '"HOUSE_TY": "확장형"'],
        ]),
      );
      expect(notice.listings[0].units[0]).toMatchObject({
        label: '확장형',
        exclusiveArea: null,
        sizeType: null,
        salePriceWon: null,
        priceNote: '공고문 참조',
      });
      expect(notice.warnings).toEqual([
        { stage: SyncStage.NORMALIZE, code: 'UNPARSEABLE_AREA', message: '주택형 확장형의 전용면적' },
      ]);
      const huge = noticeOf(
        normalize('remndr-gh-national', [['"LTTOT_TOP_AMOUNT": "49520"', '"LTTOT_TOP_AMOUNT": "9000000000000000"']]),
      );
      expect(huge.listings[0].units[0]).toMatchObject({ salePriceWon: null, priceNote: '9000000000000000' });
    });
  });

  describe('일정(ERD §4.6)', () => {
    it('APT는 특별공급·순위·거주지역별 접수와 당첨자 발표·계약을 나눠 담는다', () => {
      const { schedules, summary } = noticeOf(normalize('apt-lh-private-participation')).listings[0];
      expect(
        schedules.map((schedule) => [schedule.kind, schedule.label, schedule.startDate, schedule.endDate]),
      ).toEqual([
        [ScheduleKind.APPLY, '특별공급', '2026-09-21', '2026-09-21'],
        [ScheduleKind.APPLY, '1순위 해당지역', '2026-09-22', '2026-09-22'],
        [ScheduleKind.APPLY, '1순위 경기지역', '2026-09-22', '2026-09-22'],
        [ScheduleKind.APPLY, '1순위 기타지역', '2026-09-22', '2026-09-22'],
        [ScheduleKind.APPLY, '2순위 해당지역', '2026-09-23', '2026-09-23'],
        [ScheduleKind.APPLY, '2순위 경기지역', '2026-09-23', '2026-09-23'],
        [ScheduleKind.APPLY, '2순위 기타지역', '2026-09-23', '2026-09-23'],
        [ScheduleKind.WINNER, null, '2026-10-01', '2026-10-01'],
        [ScheduleKind.CONTRACT, null, '2026-11-09', '2026-11-11'],
      ]);
      expect(summary).toMatchObject({ applyStartDate: '2026-09-21', applyEndDate: '2026-09-23' });
    });

    it('대상별 접수 열이 비면 전체 접수 기간 하나로 담는다', () => {
      const { schedules } = noticeOf(normalize('remndr-gh-national')).listings[0];
      expect(schedules.filter((schedule) => schedule.kind === ScheduleKind.APPLY)).toEqual([
        {
          kind: ScheduleKind.APPLY,
          label: null,
          startDate: '2026-01-12',
          endDate: '2026-01-12',
          startTime: null,
          endTime: null,
          note: null,
        },
      ]);
    });

    it('대상별 접수가 일부만 와서 전체 접수 기간을 다 덮지 못하면 전체 기간도 담아 마감을 잃지 않는다', () => {
      const cleared = [
        'GNRL_RNK1_CRSPAREA_RCPTDE',
        'GNRL_RNK1_CRSPAREA_ENDDE',
        'GNRL_RNK1_ETC_AREA_RCPTDE',
        'GNRL_RNK1_ETC_AREA_ENDDE',
        'GNRL_RNK2_CRSPAREA_RCPTDE',
        'GNRL_RNK2_CRSPAREA_ENDDE',
        'GNRL_RNK2_ETC_AREA_RCPTDE',
        'GNRL_RNK2_ETC_AREA_ENDDE',
      ];
      const bundle = bundleOf('apt-gh-private');
      const detail = Object.fromEntries(Object.entries(bundle.detail).filter(([name]) => !cleared.includes(name)));
      const [listing] = noticeOf(normalizeApplyhomeNotice({ ...bundle, detail })).listings;
      const applyLabels = listing.schedules
        .filter((schedule) => schedule.kind === ScheduleKind.APPLY)
        .map((schedule) => schedule.label);
      expect(applyLabels).toEqual(['특별공급', null]);
      expect(listing.summary).toMatchObject({ applyStartDate: '2026-05-11', applyEndDate: '2026-05-14' });
    });

    it('읽지 못한 날짜는 비우고 경고한다', () => {
      const notice = noticeOf(
        normalize('remndr-gh-national', [
          ['"PRZWNER_PRESNATN_DE": "2026-01-16"', '"PRZWNER_PRESNATN_DE": "추후 공지"'],
        ]),
      );
      expect(notice.listings[0].summary.winnerDate).toBeNull();
      expect(notice.warnings).toEqual([
        { stage: SyncStage.NORMALIZE, code: 'UNPARSEABLE_DATE', message: 'PRZWNER_PRESNATN_DE: 추후 공지' },
      ]);
    });
  });

  describe('신청 인원(ERD §5 규칙 18)', () => {
    it('주택형마다 일반공급(모든 순위·거주지역) + 특별공급 신청을 더하고, 칸은 주택형 합이다', () => {
      const [listing] = noticeOf(normalize('apt-ih-consortium')).listings;
      // 060.9495A: 일반 1순위 해당 179 + 기타 84 + 2순위 해당 30 + 기타 10 = 303, 특별공급 지역 × 유형 + 기관추천 확정 = 163
      expect(listing.units[0]).toMatchObject({ label: '60.9495A', applicationCount: 466, supplyHouseholds: 25 });
      expect(listing.applicationCount).toBe(3537);
    });

    it('특별공급 세대가 없는 무순위·임의공급·오피스텔은 경쟁률의 신청 인원만 더한다', () => {
      expect(noticeOf(normalize('opt-lh')).listings[0].units[0]).toMatchObject({ applicationCount: 38 });
      expect(noticeOf(normalize('urbty-lh-officetel')).listings[0]).toMatchObject({ applicationCount: 3043 });
    });

    it('경쟁률이 없는 공고(기관이 직접 접수하는 LH 공공분양·접수 전)는 신청 인원을 정하지 않는다 — 알던 값을 지우지 않게', () => {
      const [listing] = noticeOf(normalize('apt-lh-public-sale')).listings;
      expect(listing.applicationCount).toBeUndefined();
      expect(listing.units.map((unit) => unit.applicationCount)).toEqual([undefined, undefined, undefined]);
    });

    it('특별공급 세대가 있는데 신청현황이 없으면 일반공급만으로 세지 않고 정하지 않는다', () => {
      const notice = noticeOf(normalizeApplyhomeNotice({ ...bundleOf('apt-ih-consortium'), specialApplications: [] }));
      expect(notice.listings[0].applicationCount).toBeUndefined();
      expect(notice.listings[0].units.every((unit) => unit.applicationCount === undefined)).toBe(true);
      expect(notice.warnings).toEqual([
        {
          stage: SyncStage.MATCH,
          code: 'SPECIAL_APPLICATIONS_MISSING',
          message: expect.stringContaining('특별공급 신청현황이 없어') as string,
        },
      ]);
    });

    it('특별공급만 있는 주택형(일반공급 0세대)은 일반공급 경쟁률 행이 없어도 특별공급 신청만 센다', () => {
      const bundle = bundleOf('apt-ih-consortium');
      const [first, ...rest] = bundle.models;
      const notice = noticeOf(
        normalizeApplyhomeNotice({
          ...bundle,
          models: [{ ...first, SUPLY_HSHLDCO: '0' }, ...rest],
          competitions: bundle.competitions.filter((row) => row.HOUSE_TY !== first.HOUSE_TY),
        }),
      );
      // 060.9495A의 특별공급 신청 163명(일반공급 행을 지웠다)
      expect(notice.listings[0].units[0]).toMatchObject({ label: '60.9495A', applicationCount: 163 });
      expect(notice.listings[0].applicationCount).toBe(3537 - 303);
    });

    it('주택형 목록에 없는 경쟁률 주택형은 경고하고, 다른 공고의 경쟁률이 섞이면 저장하지 않는다', () => {
      const bundle = bundleOf('opt-lh');
      const stray = { ...bundle.competitions[0], HOUSE_TY: '099.9999Z' };
      const notice = noticeOf(normalizeApplyhomeNotice({ ...bundle, competitions: [...bundle.competitions, stray] }));
      expect(notice.warnings).toEqual([
        {
          stage: SyncStage.MATCH,
          code: 'COMPETITION_TYPE_UNMATCHED',
          message: '경쟁률의 주택형(099.9999Z)이 주택형 목록에 없다',
        },
      ]);
      const foreign = { ...bundle.competitions[0], HOUSE_MANAGE_NO: '2026000001' };
      expect(normalizeApplyhomeNotice({ ...bundle, competitions: [...bundle.competitions, foreign] })).toMatchObject({
        kind: 'invalid',
        warning: { code: 'COMPETITIONS_MISMATCH' },
      });
    });
  });

  describe('믿을 수 없는 응답(ERD §5 규칙 13)', () => {
    it('주택형이 비면 기존 주택형을 지우지 않게 저장하지 않는다', () => {
      expect(normalizeApplyhomeNotice({ ...bundleOf('remndr-gh-national'), models: [] })).toEqual({
        kind: 'invalid',
        warning: { stage: SyncStage.FETCH, code: 'MODELS_EMPTY', message: '주택형 응답이 비었다' },
      });
    });

    it('다른 공고의 주택형이 섞이면 저장하지 않는다', () => {
      const bundle = bundleOf('remndr-lh-consortium');
      const foreign = { ...bundle.models[0], HOUSE_MANAGE_NO: '2026000001', PBLANC_NO: '2026000001' };
      expect(normalizeApplyhomeNotice({ ...bundle, models: [...bundle.models, foreign] })).toEqual({
        kind: 'invalid',
        warning: {
          stage: SyncStage.FETCH,
          code: 'MODELS_MISMATCH',
          message: '주택형 응답에 다른 공고(2026000001:2026000001)가 섞였다',
        },
      });
    });

    it('주택관리번호가 없으면 읽을 수 없는 공고다', () => {
      expect(
        normalize('remndr-gh-national', [['"HOUSE_MANAGE_NO": "2025910271"', '"HOUSE_MANAGE_NO": ""']]),
      ).toMatchObject({ kind: 'invalid', warning: { code: 'DETAIL_EMPTY' } });
    });
  });
});
