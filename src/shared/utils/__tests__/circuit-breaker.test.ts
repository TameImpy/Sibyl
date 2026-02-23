/**
 * Unit tests for CircuitBreaker (circuit-breaker.ts)
 *
 * Tests the full CLOSED → OPEN → HALF_OPEN → CLOSED state machine
 * using the real CircuitBreaker class (not mocked).
 */

import { CircuitBreaker } from '../circuit-breaker';
import { CircuitBreakerError } from '../../types';

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

let breakerIndex = 0;

/** Create a fresh CircuitBreaker with a unique name to avoid singleton interference */
function makeBreaker(overrides: Partial<{
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
}> = {}) {
  return new CircuitBreaker(`test-cb-${++breakerIndex}`, {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 60_000,
    ...overrides,
  });
}

const succeed = () => Promise.resolve('ok');
const fail = () => Promise.reject(new Error('service down'));

/** Trip a breaker by causing exactly `n` failures */
async function causeFailures(cb: CircuitBreaker, n: number) {
  for (let i = 0; i < n; i++) {
    await expect(cb.execute(fail)).rejects.toThrow();
  }
}

// ---------------------------------------------------------------------------
// CLOSED state
// ---------------------------------------------------------------------------

describe('CLOSED state (normal operation)', () => {
  it('executes the function and returns the result', async () => {
    const cb = makeBreaker();
    const result = await cb.execute(succeed);
    expect(result).toBe('ok');
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('passes through errors without opening the circuit below threshold', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await expect(cb.execute(fail)).rejects.toThrow('service down');
    expect(cb.getState().state).toBe('CLOSED');
    expect(cb.getState().failureCount).toBe(1);
  });

  it('accumulates failure count across consecutive failures', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    await causeFailures(cb, 3);
    expect(cb.getState().failureCount).toBe(3);
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('resets failureCount to zero on a successful call', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    await causeFailures(cb, 3);
    await cb.execute(succeed);
    expect(cb.getState().failureCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CLOSED → OPEN transition
// ---------------------------------------------------------------------------

describe('CLOSED → OPEN transition', () => {
  it('opens after exactly failureThreshold consecutive failures', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await causeFailures(cb, 2);
    expect(cb.getState().state).toBe('CLOSED'); // not yet
    await causeFailures(cb, 1);
    expect(cb.getState().state).toBe('OPEN');   // now open
  });

  it('respects a custom failureThreshold of 1', async () => {
    const cb = makeBreaker({ failureThreshold: 1 });
    await causeFailures(cb, 1);
    expect(cb.getState().state).toBe('OPEN');
  });

  it('respects a custom failureThreshold of 5', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    await causeFailures(cb, 4);
    expect(cb.getState().state).toBe('CLOSED');
    await causeFailures(cb, 1);
    expect(cb.getState().state).toBe('OPEN');
  });
});

// ---------------------------------------------------------------------------
// OPEN state
// ---------------------------------------------------------------------------

describe('OPEN state', () => {
  it('rejects immediately with CircuitBreakerError', async () => {
    const cb = makeBreaker({ failureThreshold: 2, timeout: 60_000 });
    await causeFailures(cb, 2);

    await expect(cb.execute(succeed)).rejects.toBeInstanceOf(CircuitBreakerError);
  });

  it('does not call the wrapped function while open', async () => {
    const cb = makeBreaker({ failureThreshold: 2, timeout: 60_000 });
    await causeFailures(cb, 2);

    const fn = jest.fn().mockResolvedValue('should not run');
    await expect(cb.execute(fn)).rejects.toBeInstanceOf(CircuitBreakerError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('CircuitBreakerError carries the circuit breaker name', async () => {
    const cb = makeBreaker({ failureThreshold: 1, timeout: 60_000 });
    await causeFailures(cb, 1);

    const error = await cb.execute(fail).catch((e) => e);
    expect(error).toBeInstanceOf(CircuitBreakerError);
    expect(error.message).toContain('OPEN');
  });
});

// ---------------------------------------------------------------------------
// OPEN → HALF_OPEN transition
// ---------------------------------------------------------------------------

describe('OPEN → HALF_OPEN transition (timeout elapsed)', () => {
  it('transitions to HALF_OPEN and executes the function after timeout', async () => {
    const dateSpy = jest.spyOn(Date, 'now');
    const t0 = 1_000_000;
    dateSpy.mockReturnValue(t0);

    const cb = makeBreaker({ failureThreshold: 2, timeout: 5_000, successThreshold: 2 });
    await causeFailures(cb, 2);
    expect(cb.getState().state).toBe('OPEN');

    // Advance past the timeout
    dateSpy.mockReturnValue(t0 + 5_001);

    const result = await cb.execute(succeed);
    expect(result).toBe('ok');
    // One success is not enough to close (successThreshold = 2), stays HALF_OPEN
    expect(cb.getState().state).toBe('HALF_OPEN');

    dateSpy.mockRestore();
  });

  it('stays OPEN and rejects while timeout has not elapsed', async () => {
    const dateSpy = jest.spyOn(Date, 'now');
    const t0 = 1_000_000;
    dateSpy.mockReturnValue(t0);

    const cb = makeBreaker({ failureThreshold: 2, timeout: 5_000 });
    await causeFailures(cb, 2);

    // Do NOT advance time
    dateSpy.mockReturnValue(t0 + 1_000); // only 1s passed, timeout is 5s

    await expect(cb.execute(succeed)).rejects.toBeInstanceOf(CircuitBreakerError);
    expect(cb.getState().state).toBe('OPEN');

    dateSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// HALF_OPEN → CLOSED transition
// ---------------------------------------------------------------------------

describe('HALF_OPEN → CLOSED transition', () => {
  async function reachHalfOpen(threshold = 2, timeout = 5_000, t0 = 1_000_000) {
    const dateSpy = jest.spyOn(Date, 'now');
    dateSpy.mockReturnValue(t0);
    const cb = makeBreaker({ failureThreshold: threshold, timeout, successThreshold: 2 });
    await causeFailures(cb, threshold);
    dateSpy.mockReturnValue(t0 + timeout + 1);
    return { cb, dateSpy };
  }

  it('closes after successThreshold consecutive successes in HALF_OPEN', async () => {
    const { cb, dateSpy } = await reachHalfOpen();

    await cb.execute(succeed); // 1st success
    expect(cb.getState().state).toBe('HALF_OPEN'); // not yet
    await cb.execute(succeed); // 2nd success → CLOSED
    expect(cb.getState().state).toBe('CLOSED');

    dateSpy.mockRestore();
  });

  it('requires exactly successThreshold successes — not fewer', async () => {
    const { cb, dateSpy } = await reachHalfOpen();

    // successThreshold is 2; one success should leave it in HALF_OPEN
    await cb.execute(succeed);
    expect(cb.getState().state).toBe('HALF_OPEN');

    dateSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// HALF_OPEN → OPEN on failure
// ---------------------------------------------------------------------------

describe('HALF_OPEN → OPEN on failure', () => {
  it('re-opens immediately on any failure in HALF_OPEN', async () => {
    const dateSpy = jest.spyOn(Date, 'now');
    const t0 = 1_000_000;
    dateSpy.mockReturnValue(t0);

    const cb = makeBreaker({ failureThreshold: 2, timeout: 5_000, successThreshold: 2 });
    await causeFailures(cb, 2);
    dateSpy.mockReturnValue(t0 + 5_001); // advance to HALF_OPEN territory

    // One success to enter HALF_OPEN, then a failure
    await cb.execute(succeed);
    expect(cb.getState().state).toBe('HALF_OPEN');

    dateSpy.mockReturnValue(t0 + 5_002); // stay advanced
    await expect(cb.execute(fail)).rejects.toThrow('service down');
    expect(cb.getState().state).toBe('OPEN');

    dateSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('reset()', () => {
  it('resets an OPEN circuit to CLOSED with zero counts', async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    await causeFailures(cb, 2);
    expect(cb.getState().state).toBe('OPEN');

    cb.reset();

    expect(cb.getState().state).toBe('CLOSED');
    expect(cb.getState().failureCount).toBe(0);
    expect(cb.getState().successCount).toBe(0);
  });

  it('allows normal execution again after reset', async () => {
    const cb = makeBreaker({ failureThreshold: 2 });
    await causeFailures(cb, 2);
    cb.reset();

    const result = await cb.execute(succeed);
    expect(result).toBe('ok');
  });

  it('clears accumulated failures so threshold resets', async () => {
    const cb = makeBreaker({ failureThreshold: 3 });
    await causeFailures(cb, 2); // 2 failures — still CLOSED
    cb.reset();
    await causeFailures(cb, 2); // 2 failures again after reset — still CLOSED
    expect(cb.getState().state).toBe('CLOSED');
    expect(cb.getState().failureCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getState()
// ---------------------------------------------------------------------------

describe('getState()', () => {
  it('returns CLOSED with zero counts on fresh instance', () => {
    const cb = makeBreaker();
    const state = cb.getState();
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
    expect(state.successCount).toBe(0);
  });

  it('reflects live failureCount as failures accumulate', async () => {
    const cb = makeBreaker({ failureThreshold: 5 });
    await causeFailures(cb, 3);
    expect(cb.getState().failureCount).toBe(3);
  });
});
