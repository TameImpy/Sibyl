// Re-export all types for easy imports
export * from './content';
export * from './taxonomy';

// Common error types
export class ValidationError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ProcessingError extends Error {
  constructor(
    message: string,
    public retryable: boolean = true,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ProcessingError';
  }
}

export class CircuitBreakerError extends Error {
  constructor(message: string, public service: string) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}
