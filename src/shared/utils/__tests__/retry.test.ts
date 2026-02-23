/**
 * Unit tests for retryWithBackoff and isRetryableError (retry.ts)
 *
 * Exercises the real retry logic — not a mock of it.
 */

import { retryWithBackoff, isRetryableError, RetryConfig } from '../retry';

jest.mock('../logger', () => ({
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Error whose .name matches what retryWithBackoff checks */
function retryableError(name = 'ThrottlingException'): Error {
  const e = new Error(`service error (${name})`);
  e.name = name;
  return e;
}

function nonRetryableError(): Error {
  const e = new Error('bad input');
  e.name = 'ValidationError';
  return e;
}

/**
 * Zero-delay config: retries happen immediately (sleep(0)).
 * No fake timers needed — Node's event loop drains setTimeout(0) when awaiting.
 */
const instant: Partial<RetryConfig> = {
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 2,
  maxAttempts: 3,
};

// ---------------------------------------------------------------------------
// retryWithBackoff — correctness (no fake timers)
// ---------------------------------------------------------------------------

describe('retryWithBackoff', () => {
  describe('success paths', () => {
    it('returns the result on first attempt without retrying', async () => {
      const op = jest.fn().mockResolvedValue('result');
      await expect(retryWithBackoff(op, instant)).resolves.toBe('result');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('succeeds on the second attempt after one retryable failure', async () => {
      const op = jest.fn()
        .mockRejectedValueOnce(retryableError())
        .mockResolvedValueOnce('success');
      await expect(retryWithBackoff(op, instant)).resolves.toBe('success');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('succeeds on the final allowed attempt', async () => {
      const op = jest.fn()
        .mockRejectedValueOnce(retryableError())
        .mockRejectedValueOnce(retryableError())
        .mockResolvedValueOnce('last-chance');
      await expect(retryWithBackoff(op, instant)).resolves.toBe('last-chance');
      expect(op).toHaveBeenCalledTimes(3);
    });
  });

  describe('failure paths', () => {
    it('throws immediately on a non-retryable error without retrying', async () => {
      const op = jest.fn().mockRejectedValue(nonRetryableError());
      await expect(retryWithBackoff(op, instant)).rejects.toThrow('bad input');
      expect(op).toHaveBeenCalledTimes(1);
    });

    it('exhausts all attempts for a retryable error then throws', async () => {
      const op = jest.fn().mockRejectedValue(retryableError());
      await expect(retryWithBackoff(op, instant)).rejects.toThrow();
      expect(op).toHaveBeenCalledTimes(3);
    });

    it('respects a custom maxAttempts value', async () => {
      const op = jest.fn().mockRejectedValue(retryableError());
      await expect(retryWithBackoff(op, { ...instant, maxAttempts: 5 })).rejects.toThrow();
      expect(op).toHaveBeenCalledTimes(5);
    });

    it('rethrows the original error instance, not a wrapper', async () => {
      const original = retryableError();
      const op = jest.fn().mockRejectedValue(original);
      await expect(retryWithBackoff(op, instant)).rejects.toBe(original);
    });
  });

  describe('custom retryableErrors list', () => {
    it('retries on errors that match the custom list', async () => {
      const op = jest.fn()
        .mockRejectedValueOnce(retryableError('ServiceUnavailable'))
        .mockResolvedValueOnce('recovered');
      await expect(
        retryWithBackoff(op, { ...instant, retryableErrors: ['ServiceUnavailable'] })
      ).resolves.toBe('recovered');
      expect(op).toHaveBeenCalledTimes(2);
    });

    it('does not retry on errors not in the custom list', async () => {
      const err = retryableError('PermissionDenied');
      const op = jest.fn().mockRejectedValue(err);
      await expect(
        retryWithBackoff(op, { ...instant, retryableErrors: ['ThrottlingException'] })
      ).rejects.toBe(err);
      expect(op).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Backoff timing — fake timers scoped to this describe block only
  // ---------------------------------------------------------------------------

  describe('backoff delay behaviour', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sleeps between retry attempts (setTimeout is called with a delay)', async () => {
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const op = jest.fn()
        .mockRejectedValueOnce(retryableError())
        .mockResolvedValueOnce('ok');

      const promise = retryWithBackoff(op, {
        maxAttempts: 2,
        initialDelayMs: 1000,
        maxDelayMs: 30_000,
        backoffMultiplier: 2,
      });
      // Suppress unhandled rejection during timer advancement
      promise.catch(() => {});
      await jest.runAllTimersAsync();
      await expect(promise).resolves.toBe('ok');

      const sleepCalls = setTimeoutSpy.mock.calls.filter((args) => typeof args[1] === 'number');
      expect(sleepCalls.length).toBeGreaterThan(0);
      // Delay on attempt 1 = 1000ms * 2^0 = 1000ms (plus ≤10% jitter)
      expect(sleepCalls[0][1] as number).toBeGreaterThanOrEqual(1000);
      expect(sleepCalls[0][1] as number).toBeLessThanOrEqual(1100);
    });

    it('caps the delay at maxDelayMs', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0); // eliminate jitter
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const op = jest.fn()
        .mockRejectedValueOnce(retryableError())
        .mockResolvedValueOnce('ok');

      const promise = retryWithBackoff(op, {
        maxAttempts: 2,
        initialDelayMs: 5000,
        maxDelayMs: 500, // cap well below initialDelayMs
        backoffMultiplier: 10,
      });
      promise.catch(() => {});
      await jest.runAllTimersAsync();
      await expect(promise).resolves.toBe('ok');

      const sleepCalls = setTimeoutSpy.mock.calls.filter((args) => typeof args[1] === 'number');
      expect(sleepCalls[0][1] as number).toBeLessThanOrEqual(500);
    });

    it('uses exponential backoff — second delay is double the first', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0); // eliminate jitter
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
      const op = jest.fn().mockRejectedValue(retryableError());

      const promise = retryWithBackoff(op, {
        maxAttempts: 3,
        initialDelayMs: 100,
        maxDelayMs: 30_000,
        backoffMultiplier: 2,
      });
      promise.catch(() => {});
      await jest.runAllTimersAsync();
      await expect(promise).rejects.toThrow();

      const delays = setTimeoutSpy.mock.calls
        .filter((args) => typeof args[1] === 'number')
        .map((args) => args[1] as number);

      expect(delays).toHaveLength(2); // two sleeps between 3 attempts
      expect(delays[1]).toBe(delays[0] * 2); // backoffMultiplier = 2
    });
  });
});

// ---------------------------------------------------------------------------
// isRetryableError
// ---------------------------------------------------------------------------

describe('isRetryableError', () => {
  it.each([
    ['throttled message',         'request was throttled',        'Error',            true],
    ['timeout in name',           'timed out',                    'RequestTimeout',   true],
    ['unavailable in message',    'Service temporarily unavailable', 'Error',         true],
    ['internal error in message', 'Internal server error',        'Error',            true],
    ['network error in name',     'failed to connect',            'NetworkError',     true],
    ['connection in message',     'connection refused',           'Error',            true],
    ['validation error',          'Invalid input',                'ValidationError',  false],
    ['not found',                 'Resource not found',           'NotFoundError',    false],
    ['bad request',               'Bad request payload',          'BadRequestError',  false],
  ])('%s → retryable=%s', (_desc, message, name, expected) => {
    const error = Object.assign(new Error(message), { name });
    expect(isRetryableError(error)).toBe(expected);
  });
});
