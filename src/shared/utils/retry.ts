import { getLogger } from './logger';

const logger = getLogger();

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[]; // Error names that should trigger retry
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ThrottlingException',
    'ServiceUnavailable',
    'InternalServerError',
    'RequestTimeout',
    'ECONNRESET',
    'ETIMEDOUT',
    'NetworkError',
  ],
};

/**
 * Exponential backoff with jitter for retry logic
 *
 * Best practice: Always implement retry with exponential backoff for external APIs
 * to handle transient failures gracefully and avoid thundering herd.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  context: Record<string, unknown> = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error;

  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      logger.debug('Executing operation', {
        ...context,
        attempt,
        max_attempts: finalConfig.maxAttempts,
      });

      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      const isRetryable = finalConfig.retryableErrors?.some((errorName) =>
        lastError.name.includes(errorName)
      );

      if (!isRetryable || attempt === finalConfig.maxAttempts) {
        logger.error(
          'Operation failed, no more retries',
          {
            ...context,
            attempt,
            error_name: lastError.name,
            is_retryable: isRetryable,
          },
          lastError
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const baseDelay =
        Math.min(
          finalConfig.initialDelayMs * Math.pow(finalConfig.backoffMultiplier, attempt - 1),
          finalConfig.maxDelayMs
        );
      const jitter = Math.random() * baseDelay * 0.1; // 10% jitter
      const delay = Math.floor(baseDelay + jitter);

      logger.warn(
        'Operation failed, retrying',
        {
          ...context,
          attempt,
          next_attempt: attempt + 1,
          delay_ms: delay,
          error_name: lastError.name,
        },
        lastError
      );

      await sleep(delay);
    }
  }

  // TypeScript exhaustiveness check - should never reach here
  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable based on common AWS error patterns
 */
export function isRetryableError(error: Error): boolean {
  const retryablePatterns = [
    /throttl/i,
    /timeout/i,
    /unavailable/i,
    /internal.*error/i,
    /service.*error/i,
    /network/i,
    /connection/i,
  ];

  return retryablePatterns.some((pattern) =>
    pattern.test(error.message) || pattern.test(error.name)
  );
}
