import { CircuitBreakerError } from '../types';
import { getLogger } from './logger';

const logger = getLogger();

// Circuit breaker states
enum CircuitState {
  CLOSED = 'CLOSED', // Normal operation
  OPEN = 'OPEN', // Failures exceeded threshold, reject calls
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures before opening
  successThreshold: number; // Number of successes to close from half-open
  timeout: number; // Time in ms before transitioning from open to half-open
  name: string; // Identifier for this circuit breaker
}

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  nextAttempt: number; // Timestamp when next attempt is allowed
}

/**
 * Circuit breaker implementation to prevent cascading failures
 *
 * Usage:
 *   const breaker = new CircuitBreaker('bedrock', { failureThreshold: 5, timeout: 60000 });
 *   const result = await breaker.execute(() => callBedrockAPI());
 */
export class CircuitBreaker {
  private state: CircuitBreakerState;
  private config: CircuitBreakerConfig;

  constructor(
    name: string,
    config: Partial<CircuitBreakerConfig> = {}
  ) {
    this.config = {
      name,
      failureThreshold: config.failureThreshold || 5,
      successThreshold: config.successThreshold || 2,
      timeout: config.timeout || 60000,
    };

    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      nextAttempt: Date.now(),
    };

    logger.info('Circuit breaker initialized', {
      circuit_breaker: name,
      config: this.config,
    });
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state.state === CircuitState.OPEN) {
      if (Date.now() < this.state.nextAttempt) {
        logger.warn('Circuit breaker is OPEN, rejecting request', {
          circuit_breaker: this.config.name,
          next_attempt: new Date(this.state.nextAttempt).toISOString(),
        });
        throw new CircuitBreakerError(
          `Circuit breaker ${this.config.name} is OPEN`,
          this.config.name
        );
      }

      // Transition to half-open to test service
      this.state.state = CircuitState.HALF_OPEN;
      this.state.successCount = 0;
      logger.info('Circuit breaker transitioning to HALF_OPEN', {
        circuit_breaker: this.config.name,
      });
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.state.failureCount = 0;

    if (this.state.state === CircuitState.HALF_OPEN) {
      this.state.successCount++;
      logger.debug('Circuit breaker success in HALF_OPEN', {
        circuit_breaker: this.config.name,
        success_count: this.state.successCount,
      });

      if (this.state.successCount >= this.config.successThreshold) {
        this.state.state = CircuitState.CLOSED;
        this.state.successCount = 0;
        logger.info('Circuit breaker CLOSED after successful recovery', {
          circuit_breaker: this.config.name,
        });
      }
    }
  }

  private onFailure(): void {
    this.state.failureCount++;
    logger.warn('Circuit breaker failure recorded', {
      circuit_breaker: this.config.name,
      failure_count: this.state.failureCount,
      state: this.state.state,
    });

    if (this.state.state === CircuitState.HALF_OPEN) {
      // Any failure in half-open returns to open
      this.tripBreaker();
    } else if (this.state.failureCount >= this.config.failureThreshold) {
      this.tripBreaker();
    }
  }

  private tripBreaker(): void {
    this.state.state = CircuitState.OPEN;
    this.state.nextAttempt = Date.now() + this.config.timeout;
    logger.error('Circuit breaker OPENED due to failures', {
      circuit_breaker: this.config.name,
      failure_count: this.state.failureCount,
      next_attempt: new Date(this.state.nextAttempt).toISOString(),
    });
  }

  // Get current state for monitoring
  getState(): { state: CircuitState; failureCount: number; successCount: number } {
    return {
      state: this.state.state,
      failureCount: this.state.failureCount,
      successCount: this.state.successCount,
    };
  }

  // Reset circuit breaker (for testing or manual intervention)
  reset(): void {
    this.state = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      nextAttempt: Date.now(),
    };
    logger.info('Circuit breaker reset', {
      circuit_breaker: this.config.name,
    });
  }
}

// Singleton circuit breakers per service
const circuitBreakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  name: string,
  config?: Partial<CircuitBreakerConfig>
): CircuitBreaker {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, new CircuitBreaker(name, config));
  }
  return circuitBreakers.get(name)!;
}
