/** API 정의서 '공통 인터페이스 정의서'(ITF-*)의 코드값. 값을 바꾸면 정의서도 함께 바꾼다 */

/** ITF-001 공급기관 */
export enum AgencyCode {
  ALL = 0,
  LH = 1,
  SH = 2,
  GH = 3,
  IH = 4,
}

/** 공고에 저장되는 공급기관. '전체(0)'는 검색 조건에만 쓴다 */
export type StoredAgencyCode = Exclude<AgencyCode, AgencyCode.ALL>;

export const AGENCY_NAME: Record<StoredAgencyCode, string> = {
  [AgencyCode.LH]: '한국토지주택공사',
  [AgencyCode.SH]: '서울주택도시공사',
  [AgencyCode.GH]: '경기주택도시공사',
  [AgencyCode.IH]: '인천도시공사',
};

export const isStoredAgencyCode = (value: number): value is StoredAgencyCode => value in AGENCY_NAME;

export const STORED_AGENCY_CODES: readonly StoredAgencyCode[] = Object.keys(AGENCY_NAME)
  .map(Number)
  .filter(isStoredAgencyCode);

/** ITF-002 청약 공고 상태 */
export enum SubscriptionStatusCode {
  ALL = 0,
  UPCOMING = 1,
  OPEN = 2,
  CLOSED = 3,
  CANCELLED = 4,
}

/** ITF-004 지역 */
export enum RegionCode {
  ALL = 0,
  SEOUL = 1,
  INCHEON = 2,
  GYEONGGI = 3,
}

export type StoredRegionCode = Exclude<RegionCode, RegionCode.ALL>;

export const REGION_NAME: Record<StoredRegionCode, string> = {
  [RegionCode.SEOUL]: '서울',
  [RegionCode.INCHEON]: '인천',
  [RegionCode.GYEONGGI]: '경기',
};

export const isStoredRegionCode = (value: number): value is StoredRegionCode => value in REGION_NAME;

export const STORED_REGION_CODES: readonly StoredRegionCode[] = Object.keys(REGION_NAME)
  .map(Number)
  .filter(isStoredRegionCode);

/** ITF-012 사용자 역할. 비회원(GUEST)은 저장하지 않는다(ERD §4.13) */
export enum UserRole {
  CITIZEN = 'CITIZEN',
  OPERATOR = 'OPERATOR',
  ADMIN = 'ADMIN',
}

const USER_ROLE_RANK: Readonly<Record<UserRole, number>> = {
  [UserRole.CITIZEN]: 0,
  [UserRole.OPERATOR]: 1,
  [UserRole.ADMIN]: 2,
};

export const isUserRole = (value: string): value is UserRole => Object.hasOwn(USER_ROLE_RANK, value);

/** 감사 로그는 행동 당시 가장 높은 역할을 남긴다(ERD §4.19) */
export const highestRoleOf = (roles: readonly UserRole[]): UserRole | null =>
  roles.reduce<UserRole | null>(
    (highest, role) => (highest === null || USER_ROLE_RANK[role] > USER_ROLE_RANK[highest] ? role : highest),
    null,
  );
