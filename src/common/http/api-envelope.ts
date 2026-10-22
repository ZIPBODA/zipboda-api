import { ERROR_CODES, type ErrorName } from '../errors/error-codes.js';

export interface ApiError {
  code: string;
  message: string;
}

export type ApiEnvelope<T> = { success: true; data: T; error: null } | { success: false; data: null; error: ApiError };

export const successEnvelope = <T>(data: T): ApiEnvelope<T> => ({ success: true, data, error: null });

export const errorEnvelope = (errorName: ErrorName): ApiEnvelope<never> => ({
  success: false,
  data: null,
  error: { code: ERROR_CODES[errorName].code, message: errorName },
});
