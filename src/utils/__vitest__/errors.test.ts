import { describe, expect, test } from 'vitest';
import { AxiosError } from 'axios';
import type { Neo4jError } from 'neo4j-driver';
import {
  classifyError,
  ErrorCategory,
  isNetworkError,
  isTimeoutError,
  isValidationError,
} from '../errors.js';

describe('Error classification', () => {
  test('treats transient Axios errors without status as transient', () => {
    const axiosError = new AxiosError('connection reset', 'ECONNABORTED');
    expect(classifyError(axiosError)).toBe(ErrorCategory.TRANSIENT);
  });

  test('treats 503 responses as transient', () => {
    const response = {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {},
      config: {},
      data: {},
    };
    const axiosError = new AxiosError('server failing', 'ECONNABORTED', undefined, undefined, response);
    expect(classifyError(axiosError)).toBe(ErrorCategory.TRANSIENT);
  });

  test('treats 400 responses as permanent', () => {
    const response = {
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: {},
      data: {},
    };
    const axiosError = new AxiosError('bad request', undefined, undefined, undefined, response);
    expect(classifyError(axiosError)).toBe(ErrorCategory.PERMANENT);
  });

  test('classifies transient Neo4j errors correctly', () => {
    const transientError = {
      name: 'Neo4jError',
      code: 'Neo.TransientError.Transaction.DeadlockDetected',
    } as Neo4jError;

    expect(classifyError(transientError)).toBe(ErrorCategory.TRANSIENT);
  });

  test('classifies Neo4j database errors as critical', () => {
    const databaseError = {
      name: 'Neo4jError',
      code: 'Neo.DatabaseError.General.UnknownError',
    } as Neo4jError;

    expect(classifyError(databaseError)).toBe(ErrorCategory.CRITICAL);
  });

  test('classifies Neo4j client errors as permanent', () => {
    const clientError = {
      name: 'Neo4jError',
      code: 'Neo.ClientError.Schema.ConstraintValidationFailed',
    } as Neo4jError;

    expect(classifyError(clientError)).toBe(ErrorCategory.PERMANENT);
  });
});

describe('Error type guards', () => {
  test('identifies known network error codes', () => {
    expect(isNetworkError({ code: 'ECONNRESET' })).toBe(true);
    expect(isNetworkError({ code: 'ETIMEDOUT' })).toBe(false);
  });

  test('detects timeout errors by code and message', () => {
    expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTimeoutError(new Error('request timeout occurred'))).toBe(true);
    expect(isTimeoutError(new Error('other error'))).toBe(false);
  });

  test('detects validation errors by name', () => {
    const validationError = new Error('bad input');
    validationError.name = 'ValidationError';

    expect(isValidationError(validationError)).toBe(true);

    const zodError = new Error('zod failed');
    zodError.name = 'ZodError';
    expect(isValidationError(zodError)).toBe(true);

    expect(isValidationError(new Error('other'))).toBe(false);
  });
});
