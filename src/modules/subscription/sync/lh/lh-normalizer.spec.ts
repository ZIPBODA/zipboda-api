import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RegionCode } from '@/common/constants/interface-codes.js';
import { ScheduleKind, SupplyCategory, SyncStage } from '../../constants.js';
import type { NormalizedNotice, NormalizeResult } from '../normalized-notice.js';
import { normalizeLhNotice } from './lh-normalizer.js';
import { lhBundleOf } from './lh-raw.js';

// 2026-11-06 LH API에서 받은 실제 응답(공급행은 앞 4행만 남김) — test/fixtures/lh
const fixtureText = (name: string) =>
  readFileSync(path.join(process.cwd(), 'test', 'fixtures', 'lh', `${name}.json`), 'utf8');

/** 원문 일부를 바꿔 경계 사례를 만든다 — 응답 모양은 그대로 둔 채 값만 고친다 */
const normalize = (name: string, edits: [string, string][] = []): NormalizeResult => {
  const text = edits.reduce((current, [from, to]) => {
    if (!current.includes(from)) throw new Error(`테스트 자료 ${name}에 '${from}'이 없습니다`);
    return current.replaceAll(from, to);
  }, fixtureText(name));
  return normalizeLhNotice(lhBundleOf(JSON.parse(text)));
};

const noticeOf = (result: NormalizeResult): NormalizedNotice => {
  if (result.kind !== 'notice') throw new Error(`공고가 아니라 ${result.kind}로 나왔습니다`);
  return result.notice;
};

describe('LH 공고 정규화', () => {
  describe('수집 분류(ERD §5 규칙 14)', () => {
    it.each([
      ['purchase-operator-recruit', '입주자가 아니라 운영기관을 모집하는 공고'],
      ['daycare', '가정어린이집 운영자 모집'],
      ['jeonse-lease', '전세임대'],
    ])('%s는 수집 범위 밖이다', (name, reason) => {
      expect(normalize(name)).toEqual({ kind: 'excluded', reason, warnings: [] });
    });

    it('매입임대가 아닌 유형은 공고명에 운영기관이 있어도 분류표대로 모은다', () => {
      expect(normalize('sale', [['인천가정2 B2블록 공공분양', '인천가정2 B2블록 운영기관 공공분양']])).toMatchObject({
        kind: 'notice',
      });
    });

    it('모르는 연계시스템은 필드를 잘못 읽지 않게 분류하지 않는다', () => {
      expect(normalize('permanent-multi-complex', [['"CCR_CNNT_SYS_DS_CD": "03"', '"CCR_CNNT_SYS_DS_CD": "01"']])).toMatchObject({
        kind: 'unclassified',
        warning: { code: 'UNCLASSIFIED_TYPE' },
      });
    });

    it('분류표에 없는 유형은 저장하지 않고 경고로 알린다', () => {
      const result = normalize('sale', [['"AIS_TP_CD": "05"', '"AIS_TP_CD": "99"']]);
      expect(result).toMatchObject({
        kind: 'unclassified',
        warning: { stage: SyncStage.NORMALIZE, code: 'UNCLASSIFIED_TYPE' },
      });
    });

    it.each([
      ['sale', SupplyCategory.SALE],
      ['vacant-sale', SupplyCategory.SALE],
      ['newlywed-sale', SupplyCategory.SALE],
      ['happy-corrected', SupplyCategory.PUBLIC_RENTAL],
      ['public-rental-6y', SupplyCategory.PUBLIC_RENTAL],
      ['purchase-jeonse-area-ranges', SupplyCategory.PURCHASE_RENTAL],
    ])('%s → %s', (name, category) => {
      expect(noticeOf(normalize(name)).supplyCategory).toBe(category);
    });
  });

  it('공고 필드: 원천 키는 연계시스템과 공고번호, 게시일은 날짜로, 재조회 코드를 남긴다', () => {
    const notice = noticeOf(normalize('permanent-multi-complex'));
    expect(notice).toMatchObject({
      source: 'LH',
      sourceKey: '03:2015122300019045',
      sourceParams: { CCR_CNNT_SYS_DS_CD: '03', PAN_ID: '2015122300019045', UPP_AIS_TP_CD: '06', AIS_TP_CD: '09', CNP_CD: '11' },
      agencyCode: 1,
      title: '2025년 서울특별시 영구임대주택 예비입주자 모집',
      correctionMarks: 0,
      supplyType: '영구임대',
      postDate: '2025-11-13',
      sourceStatus: '접수마감',
      warnings: [],
    });
    expect(notice.attachments[0]).toEqual({
      name: '2025년서울시영구임대주택예비입주자모집공고문(LH).hwp',
      url: 'https://apply.lh.or.kr/lhapply/lhFile.do?fileid=64322768',
      kind: '공고문(hwp)',
    });
  });

  it('정정 표시(접두어 여러 번·접미어)를 세고, 묶음 이름에서는 뗀다(ERD §5 규칙 7)', () => {
    expect(noticeOf(normalize('national-corrected-suffix'))).toMatchObject({
      correctionMarks: 2,
      titleKey: '도봉주공1단지 국민임대주택 예비입주자 모집 공고',
    });
    expect(noticeOf(normalize('public-rental-6y'))).toMatchObject({
      correctionMarks: 2,
      titleKey: '군포대야미 A-1블록 6년 분양전환공공임대주택 입주자모집공고',
    });
  });

  describe('단지 목록이 있는 공고(건설임대·분양)', () => {
    it('단지마다 칸을 만들고, 단지 이름이 있는 일정은 그 단지의 칸에만 넣는다', () => {
      const { listings } = noticeOf(normalize('permanent-multi-complex'));
      expect(listings).toHaveLength(7);
      expect(listings[0].complex).toEqual({
        name: '서울강남 A3BL(영구)',
        nameKey: '서울강남 A3BL(영구)',
        aliasable: true,
        sigungu: '강남구',
        address: '서울특별시 강남구 자곡로3길 22(자곡동,강남 에버시움)',
        addressKey: '서울특별시 강남구 자곡로3길 22',
        households: 192,
        areaMin: 21.78,
        areaMax: 29.43,
        imageUrl: null,
      });
      expect(listings[0]).toMatchObject({ regionCode: RegionCode.SEOUL, moveInMonth: '2013-11' });
      for (const listing of listings) {
        expect(listing.schedules.map((schedule) => schedule.kind)).toEqual([ScheduleKind.APPLY, ScheduleKind.WINNER]);
      }
    });

    it('일정의 단지를 찾지 못하면 모든 칸에 넣고 경고를 남긴다', () => {
      const notice = noticeOf(normalize('permanent-multi-complex', [['"SBD_LGO_NM": "서울우면"', '"SBD_LGO_NM": "없는단지"']]));
      // 서울우면(셋째)은 자기 일정을 잃고, 갈 곳 없는 그 일정(2건)이 모든 칸에 더해진다
      expect(notice.listings.map((listing) => listing.schedules.length)).toEqual([4, 4, 2, 4, 4, 4, 4]);
      expect(notice.warnings).toEqual([expect.objectContaining({ code: 'SCHEDULE_COMPLEX_UNMATCHED' })]);
    });

    it('접수 마감 날짜와 접수 시각의 날짜가 다르면 날짜는 SBSC_ACP_*를 따르고 그쪽 시각을 비운다(ERD §5 규칙 9)', () => {
      const notice = noticeOf(normalize('national-corrected-suffix'));
      const [listing] = notice.listings;
      expect(listing.schedules[0]).toEqual({
        kind: ScheduleKind.APPLY,
        label: null,
        startDate: '2025-09-16',
        endDate: '2025-09-17',
        startTime: '10:00',
        endTime: null,
        note: null,
      });
      expect(listing.summary).toMatchObject({ applyStartDate: '2025-09-16', applyEndDate: '2025-09-17' });
      expect(notice.warnings).toEqual([
        expect.objectContaining({ stage: SyncStage.NORMALIZE, code: 'APPLY_TIME_DATE_MISMATCH' }),
      ]);
    });

    it('연계 03 주택형: 표기·전용면적·세대, 숫자가 아닌 금액은 안내로 둔다', () => {
      const [listing] = noticeOf(normalize('happy-corrected')).listings;
      expect(listing.units[0]).toMatchObject({
        label: '16A',
        sizeType: '16',
        unitType: 'A',
        exclusiveArea: 16.99,
        supplyArea: 25.4883,
        totalHouseholds: 56,
        supplyHouseholds: 25,
        depositWon: null,
        priceNote: '공고문 참조',
      });
      expect(listing.supplyUnits).toBe(65);
      expect(listing.complex?.imageUrl).toBe('https://apply.lh.or.kr/lhapply/lhImageView2.do?fileid=45756529');
      expect(listing.summary).toEqual({
        applyStartDate: '2026-08-31',
        applyEndDate: '2026-09-02',
        winnerDate: '2026-12-07',
        contractStartDate: '2027-01-01',
        contractEndDate: '2028-12-31',
      });
    });

    it('연계 02: 대상별 일정(접수 시각·비고·당첨자 서류), 원 단위 보증금·월임대료', () => {
      const [listing] = noticeOf(normalize('public-rental-10y')).listings;
      expect(listing.schedules).toEqual([
        {
          kind: ScheduleKind.APPLY,
          label: '무순위',
          startDate: '2025-09-02',
          endDate: '2025-09-02',
          startTime: '10:00',
          endTime: '16:00',
          note: '인터넷접수',
        },
        expect.objectContaining({ kind: ScheduleKind.WINNER, label: '무순위', startDate: '2025-09-08' }),
        expect.objectContaining({ kind: ScheduleKind.WINNER_DOC, startDate: '2025-09-08', endDate: '2025-09-12' }),
      ]);
      expect(listing.units[0]).toMatchObject({
        label: '61.7200A',
        unitType: 'A',
        exclusiveArea: 61.72,
        depositWon: 43_906_000n,
        monthlyRentWon: 546_020n,
      });
      expect(listing).toMatchObject({ moveInMonth: '2022-02', regionCode: RegionCode.INCHEON });
    });

    it('연계 02 분양가는 원 단위, 상세 주소를 이어 판별 키를 만든다', () => {
      const [sale] = noticeOf(normalize('sale')).listings;
      expect(sale.units[0]).toMatchObject({ label: '84.0000A', salePriceWon: 613_425_000n, supplyHouseholds: 151 });
      expect(sale.complex?.addressKey).toBeNull();
      const [newlywed] = noticeOf(normalize('newlywed-sale')).listings;
      expect(newlywed.complex).toMatchObject({
        address: '서울특별시 노원구 공릉동 240-1 일원 (서울공릉 신혼희망타운)',
        addressKey: '서울특별시 노원구 공릉동 240-1',
        areaMin: 59.95,
        areaMax: 74.98,
      });
    });

    it('공급행은 단지 이름으로 칸에 나누고, 단지별 공급 안내를 담는다', () => {
      const { listings } = noticeOf(normalize('vacant-sale'));
      expect(listings.map((listing) => [listing.complex?.name, listing.units.length])).toEqual([
        ['서울강남권도시형주택(석촌)', 1],
        ['서울강남권도시형주택(송파)', 0],
      ]);
      expect(listings[0].supplyNote).toMatch(/예비자\(10배수\)/);
    });
  });

  describe('단지 목록이 없는 공고(매입임대)', () => {
    it('건물 이름별로 칸을 만들고, 주택형 없는 공급 호수·모집 인원을 칸에 더한다', () => {
      const { listings } = noticeOf(normalize('purchase-youth-building-names'));
      expect(listings.map((listing) => listing.complex?.name)).toEqual([
        '종로연지동(대보213)',
        '종로숭인동(시티플러스)',
        '종로인의동(루비온오피스텔)',
        '종로관철동(프라움스테이)',
      ]);
      expect(listings[0]).toMatchObject({
        complex: { aliasable: true, sigungu: null, address: null, addressKey: null },
        regionCode: RegionCode.SEOUL,
        supplyUnits: 1,
        recruitCount: 3,
        units: [],
      });
    });

    it('호별 주소가 있으면 주소로 단지를 나누고, 이름은 별칭으로 남기지 않는다', () => {
      const { listings } = noticeOf(normalize('purchase-per-unit-address'));
      expect(listings.map((listing) => [listing.complex?.name, listing.complex?.addressKey])).toEqual([
        ['한결주택', '경기도 부천시 소사구 소사로148번길 58-9'],
        ['나눔주택', '경기도 부천시 소사구 소사로170번길 58-9'],
        ['나눔주택', '경기도 부천시 소사구 은성로68번길 57-11'],
        ['행복꿈터 제가동', '경기도 부천시 소사구 하우로 274'],
      ]);
      expect(listings[0]).toMatchObject({
        regionCode: RegionCode.GYEONGGI,
        complex: { aliasable: false, sigungu: '부천시' },
        units: [{ unitNumber: '403호', floorLabel: '4층', exclusiveArea: 54.26, sizeType: '54', supplyHouseholds: 1 }],
      });
    });

    it('주택형이 면적 구간("70~80㎡")이면 구간으로, 시군구는 SGG_NM에서 읽는다', () => {
      const { listings } = noticeOf(normalize('purchase-jeonse-area-ranges'));
      expect(listings[0]).toMatchObject({
        complex: { name: '강동둔촌동(은슬림둔촌)', sigungu: '강동구' },
        units: [{ label: '70~80㎡', areaMin: 70, areaMax: 80, exclusiveArea: null, sizeType: null, recruitCount: 4 }],
      });
      // "80㎡ 이상"처럼 한쪽만 있는 구간은 면적 범위 짝 제약에 맞지 않아 표기만 둔다
      expect(listings[1].units[1]).toMatchObject({ label: '80㎡ 이상', areaMin: null, areaMax: null });
    });

    it('리츠 매입임대는 단지명 앞의 (지역구)를 시군구로 읽는다', () => {
      const [listing] = noticeOf(normalize('purchase-reits')).listings;
      expect(listing).toMatchObject({
        complex: { name: '신림동 관악산휴먼시아1단지', sigungu: '관악구' },
        units: [{ label: '전용59㎡', exclusiveArea: 59, sizeType: '59', supplyHouseholds: 1, recruitCount: 10 }],
      });
    });

    it('공급행이 없으면(주택 목록이 첨부 파일뿐) 조회 지역의 공고 단위 칸 하나다', () => {
      const { listings } = noticeOf(normalize('purchase-no-supply'));
      expect(listings).toHaveLength(1);
      expect(listings[0]).toMatchObject({ complex: null, regionCode: RegionCode.GYEONGGI, units: [] });
      expect(listings[0].schedules.map((schedule) => schedule.kind)).toContain(ScheduleKind.VIEWING);
    });

    it('지역만 적은 일반명 공급행은 단지로 합치지 않고 공고 단위 칸의 주택형으로 둔다', () => {
      const { listings } = noticeOf(
        normalize('purchase-operator-recruit', [['2026년 하반기 매입임대 공동생활가정 운영기관 모집공고', '매입임대 입주자 모집공고']]),
      );
      expect(listings).toHaveLength(1);
      expect(listings[0]).toMatchObject({
        complex: null,
        recruitCount: 3,
        units: [
          { label: '2형', recruitCount: 2, note: '3~4인 가구' },
          { label: '1형', recruitCount: 1, note: '2인 이하 가구' },
        ],
      });
    });

    it('수집 지역 밖 건물은 건너뛰고, 남는 칸이 없으면 공고를 저장하지 않는다', () => {
      const partial = noticeOf(
        normalize('purchase-per-unit-address', [['경기도 부천시 소사구 하우로', '충청남도 천안시 동남구 하우로']]),
      );
      expect(partial.listings).toHaveLength(3);
      expect(partial.warnings).toEqual([expect.objectContaining({ code: 'OUT_OF_REGION' })]);
      expect(normalize('purchase-per-unit-address', [['경기도 부천시', '충청남도 천안시']])).toEqual({
        kind: 'excluded',
        reason: '수집 지역(서울·인천·경기) 안의 단지·건물이 없다',
        warnings: [expect.objectContaining({ code: 'OUT_OF_REGION' })],
      });
    });

    it('시도 이름이 아닌 지역 값은 건너뛰지 않고 조회 지역으로 두며, 경고는 한 건으로 합친다', () => {
      const notice = noticeOf(normalize('purchase-youth-building-names', [['"CNP_NM": "서울특별시"', '"CNP_NM": "서울지역본부"']]));
      expect(notice.listings).toHaveLength(4);
      expect(notice.listings.every((listing) => listing.regionCode === RegionCode.SEOUL)).toBe(true);
      expect(notice.warnings).toEqual([expect.objectContaining({ code: 'UNKNOWN_SIDO' })]);
    });
  });

  describe('단지를 건너뛰거나 합칠 때', () => {
    const SEOKCHON_ADDRESS = '서울특별시 송파구 가락로11길 8-19(석촌동';

    it('수집 지역 밖이라 건너뛴 단지의 공급행·일정은 남은 단지에 붙이지 않는다', () => {
      const baseline = noticeOf(normalize('vacant-sale')).listings[1];
      const notice = noticeOf(normalize('vacant-sale', [[SEOKCHON_ADDRESS, '충청남도 천안시 가락로11길 8-19(석촌동']]));
      expect(notice.listings).toHaveLength(1);
      expect(notice.listings[0].complex?.name).toBe('서울강남권도시형주택(송파)');
      expect(notice.listings[0].units).toEqual([]);
      expect(notice.listings[0].schedules).toEqual(baseline.schedules);
      expect(notice.warnings).toEqual([expect.objectContaining({ code: 'OUT_OF_REGION' })]);
    });

    it('공급행은 순서가 아니라 단지 이름으로 칸을 찾는다', () => {
      const notice = noticeOf(
        normalize('vacant-sale', [
          ['"SBD_LGO_NM": "서울강남권도시형주택(석촌)",\n          "DDO_AR"', '"SBD_LGO_NM": "서울강남권도시형주택(송파)",\n          "DDO_AR"'],
        ]),
      );
      expect(notice.listings.map((listing) => listing.units.length)).toEqual([0, 1]);
    });

    it('단지가 하나뿐인 공고는 공급행이 단지를 다른 이름으로 불러도 그 단지에 넣고 경고를 남긴다', () => {
      const notice = noticeOf(normalize('happy-corrected', [['"SBD_LGO_NM": "서울번동3 행복주택"', '"SBD_LGO_NM": "번동3단지"']]));
      expect(notice.listings[0].units).toHaveLength(3);
      expect(notice.warnings).toEqual([expect.objectContaining({ code: 'UNIT_COMPLEX_NAME_DIFFERS' })]);
    });

    it('주소 판별 키가 같은 단지 행은 한 칸으로 합치고 두 이름의 일정을 모두 받는다', () => {
      const notice = noticeOf(
        normalize('permanent-multi-complex', [['서울특별시 강서구 공항대로39길 59(등촌동', '서울특별시 강서구 강서로68길 36(등촌동']]),
      );
      expect(notice.listings).toHaveLength(6);
      const merged = notice.listings.find((listing) => listing.complex?.name === '서울등촌1');
      expect(merged?.schedules).toHaveLength(4);
      expect(notice.warnings).toEqual([expect.objectContaining({ code: 'COMPLEX_MERGED_BY_ADDRESS' })]);
    });

    it('주소 없이 지역만 적은 일반명 단지는 단지로 두지 않고 공고 단위 칸으로 모은다', () => {
      const notice = noticeOf(
        normalize('permanent-multi-complex', [
          ['"LCC_NT_NM": "서울우면"', '"LCC_NT_NM": "매입다가구(서울서초구)"'],
          ['"LGDN_ADR": "서울특별시 서초구 바우뫼로7길 11(우면동,우면주공아파트)"', '"LGDN_ADR": ""'],
          ['"SBD_LGO_NM": "서울우면"', '"SBD_LGO_NM": "매입다가구(서울서초구)"'],
        ]),
      );
      expect(notice.listings).toHaveLength(7);
      const noticeLevel = notice.listings.filter((listing) => listing.complex === null);
      expect(noticeLevel).toHaveLength(1);
      expect(noticeLevel[0].schedules.map((schedule) => schedule.kind)).toEqual([ScheduleKind.APPLY, ScheduleKind.WINNER]);
    });

    it('이름이 빈 단지는 건너뛰고, 그 이름을 가리키던 일정은 모든 칸에 넣는다', () => {
      const notice = noticeOf(normalize('permanent-multi-complex', [['"LCC_NT_NM": "서울우면"', '"LCC_NT_NM": ""']]));
      expect(notice.listings).toHaveLength(6);
      expect(notice.warnings.map((warning) => warning.code)).toEqual(['COMPLEX_NAME_MISSING', 'SCHEDULE_COMPLEX_UNMATCHED']);
    });
  });

  describe('읽지 못한 값', () => {
    it('읽지 못한 날짜·입주 시기는 비우고, 같은 코드의 경고는 공고당 한 건으로 합친다', () => {
      const notice = noticeOf(
        normalize('permanent-multi-complex', [
          ['"PZWR_ANC_DT": "2026.03.19"', '"PZWR_ANC_DT": "추후 공지"'],
          ['"MVIN_XPC_YM": "2013.11"', '"MVIN_XPC_YM": "미정"'],
        ]),
      );
      expect(notice.listings[0]).toMatchObject({ moveInMonth: null, summary: { winnerDate: null } });
      expect(notice.warnings.map((warning) => warning.code).sort()).toEqual(['UNPARSEABLE_DATE', 'UNPARSEABLE_MONTH']);
    });

    it('끝이 시작보다 이른 일정은 끝을 비운다', () => {
      const notice = noticeOf(
        normalize('happy-corrected', [
          ['"CTRT_ST_DT": "2027.01.01"', '"CTRT_ST_DT": "2029.01.01"'],
        ]),
      );
      expect(notice.listings[0].summary).toMatchObject({ contractStartDate: '2029-01-01', contractEndDate: null });
      expect(notice.warnings).toEqual([expect.objectContaining({ code: 'SCHEDULE_PERIOD_INVERTED' })]);
    });

    it('상세에 일정 목록이 없으면(빈 응답) 단지 없는 칸으로 읽지 않고 읽을 수 없는 공고로 돌려준다', () => {
      expect(normalize('permanent-multi-complex', [['"dsSplScdl"', '"dsSplScdlMissing"']])).toMatchObject({
        kind: 'invalid',
        warning: { stage: SyncStage.FETCH, code: 'DETAIL_EMPTY' },
      });
    });
  });

  // 저장 단계(PR 2b)가 DB 제약에 막히지 않도록 모든 실제 응답의 정규화 결과가 지켜야 할 것
  describe('DB 제약과 맞는 결과', () => {
    const FIXTURES = [
      'permanent-multi-complex',
      'national-corrected-suffix',
      'happy-corrected',
      'public-rental-10y',
      'public-rental-6y',
      'sale',
      'newlywed-sale',
      'vacant-sale',
      'purchase-youth-building-names',
      'purchase-per-unit-address',
      'purchase-jeonse-area-ranges',
      'purchase-no-supply',
      'purchase-reits',
    ];
    const MAX_INT = 2_147_483_647;

    it.each(FIXTURES)('%s', (name) => {
      const notice = noticeOf(normalize(name));
      const addressKeys = notice.listings.flatMap((listing) => (listing.complex?.addressKey ? [listing.complex.addressKey] : []));
      expect(new Set(addressKeys).size).toBe(addressKeys.length);
      expect(notice.listings.filter((listing) => listing.complex === null).length).toBeLessThanOrEqual(1);
      const warningKeys = notice.warnings.map((warning) => `${warning.stage}:${warning.code}`);
      expect(new Set(warningKeys).size).toBe(warningKeys.length);
      for (const listing of notice.listings) {
        const { applyStartDate, applyEndDate } = listing.summary;
        if (applyStartDate && applyEndDate) expect(applyStartDate <= applyEndDate).toBe(true);
        for (const schedule of listing.schedules) {
          if (schedule.startDate && schedule.endDate) expect(schedule.startDate <= schedule.endDate).toBe(true);
        }
        for (const area of [listing.complex, ...listing.units]) {
          if (area) expect(area.areaMin === null).toBe(area.areaMax === null);
        }
        for (const unit of listing.units) {
          for (const won of [unit.depositWon, unit.monthlyRentWon, unit.salePriceWon]) {
            if (won !== null) expect(won >= 0n).toBe(true);
          }
          for (const count of [unit.totalHouseholds, unit.supplyHouseholds, unit.recruitCount]) {
            if (count !== null) expect(count).toBeLessThanOrEqual(MAX_INT);
          }
        }
      }
    });
  });
});
