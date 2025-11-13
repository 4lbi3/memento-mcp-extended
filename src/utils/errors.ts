import type { AxiosError } from 'axios';
import type { Neo4jError } from 'neo4j-driver';

const TRANSIENT_NETWORK_CODES = new Set(["ECONNRESET", "ECONNABORTED", "ECONNREFUSED", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "ENOTFOUND"]);
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT", "ECONNABORTED"]);
const VALIDATION_ERROR_NAMES = new Set(["ValidationError", "ZodError"]);
const NEO4J_TRANSIENT_PREFIX = "Neo.TransientError";
const NEO4J_CLIENT_PREFIX = "Neo.ClientError";
const NEO4J_DATABASE_PREFIX = "Neo.DatabaseError";

export enum ErrorCategory {
  TRANSIENT = 'transient',
  PERMANENT = 'permanent',
  CRITICAL = 'critical',
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function hasErrorName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}

export function isNetworkError(error: unknown): error is Error & { code?: string } {
  const code = getErrorCode(error);
  return !!code && TRANSIENT_NETWORK_CODES.has(code);
}

export function isTimeoutError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && TIMEOUT_CODES.has(code)) {
    return true;
  }

  return hasErrorName(error, 'AbortError') ||
    (error instanceof Error && /timeout/i.test(error.message));
}

export function isValidationError(error: unknown): error is Error {
  return error instanceof Error && VALIDATION_ERROR_NAMES.has(error.name);
}

function isAxiosError(error: unknown): error is AxiosError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error &&
    (error as { isAxiosError?: unknown }).isAxiosError === true
  );
}

function isNeo4jError(error: unknown): error is Neo4jError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string' &&
    hasErrorName(error, 'Neo4jError')
  );
}

export function classifyError(error: unknown): ErrorCategory {
  if (isNeo4jError(error)) {
    const code = error.code || '';

    if (code.startsWith(NEO4J_TRANSIENT_PREFIX)) {
      return ErrorCategory.TRANSIENT;
    }

    if (code.startsWith(NEO4J_DATABASE_PREFIX)) {
      return ErrorCategory.CRITICAL;
    }

    if (code.startsWith(NEO4J_CLIENT_PREFIX)) {
      return ErrorCategory.PERMANENT;
    }

    return ErrorCategory.PERMANENT;
  }

  if (isAxiosError(error)) {
    const status = error.response?.status;

    if (!status) {
      return ErrorCategory.TRANSIENT;
    }

    if (status >= 500 || status === 429 || status === 503) {
      return ErrorCategory.TRANSIENT;
    }

    if (status >= 400 && status < 500) {
      return ErrorCategory.PERMANENT;
    }

    return ErrorCategory.TRANSIENT;
  }

  if (isTimeoutError(error) || isNetworkError(error)) {
    return ErrorCategory.TRANSIENT;
  }

  if (isValidationError(error)) {
    return ErrorCategory.PERMANENT;
  }

  if (error instanceof Error) {
    return ErrorCategory.PERMANENT;
  }

  return ErrorCategory.PERMANENT;
}
