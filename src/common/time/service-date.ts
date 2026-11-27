/** 공고 일정(접수 시작·마감·D-day)과 약관 시행일을 세는 기준 시간대 */
export const SERVICE_TIME_ZONE = 'Asia/Seoul';

const serviceDateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: SERVICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 서버가 어느 시간대에서 돌든 날짜는 한국 날짜로 센다 — 자정 직후 UTC 서버가 하루 늦게 마감시키지 않게.
 * 로캘마다 날짜 표기 순서가 달라 조각을 받아 직접 잇는다. 조각이 빠지면 잘못된 날짜로 상태를 지어내지 않고 실패한다
 */
export const serviceDateOf = (now: Date): string => {
  const parts = serviceDateFormat.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((entry) => entry.type === type)?.value;
    if (!value) throw new Error(`날짜 조각(${type})을 얻지 못했습니다`);
    return value;
  };
  return `${part('year')}-${part('month')}-${part('day')}`;
};
