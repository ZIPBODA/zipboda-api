import type { NormalizationWarning } from './normalized-notice.js';

const MESSAGE_SEPARATOR = ' / ';

/** 같은 사정이 칸·행마다 되풀이되어도 동기화 기록(sync_failures)은 (단계, 코드)당 한 건이라 메시지를 이어 붙여 합친다 */
export const mergeWarnings = (warnings: NormalizationWarning[]): NormalizationWarning[] => {
  const merged = new Map<string, NormalizationWarning>();
  for (const warning of warnings) {
    const key = `${warning.stage}:${warning.code}`;
    const existing = merged.get(key);
    if (existing === undefined) merged.set(key, { ...warning });
    else if (!existing.message.split(MESSAGE_SEPARATOR).includes(warning.message)) {
      existing.message += `${MESSAGE_SEPARATOR}${warning.message}`;
    }
  }
  return [...merged.values()];
};
