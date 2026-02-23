// Structured logging utility for AWS Lambda
// Outputs JSON logs compatible with CloudWatch Insights

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

interface LogContext {
  trace_id?: string;
  content_id?: string;
  content_type?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    name?: string;
  };
}

class Logger {
  private context: LogContext = {};
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = LogLevel.INFO) {
    this.minLevel = minLevel;
  }

  setContext(context: LogContext): void {
    this.context = { ...this.context, ...context };
  }

  clearContext(): void {
    this.context = {};
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.minLevel);
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: Error): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { ...this.context, ...context },
    };

    if (error) {
      entry.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    // Use console.log for CloudWatch - it preserves JSON structure
    console.log(JSON.stringify(entry));
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.WARN, message, context, error);
  }

  error(message: string, context?: LogContext, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }
}

// Singleton logger instance
let loggerInstance: Logger | null = null;

export function getLogger(minLevel?: LogLevel): Logger {
  if (!loggerInstance) {
    const level = minLevel || (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO;
    loggerInstance = new Logger(level);
  }
  return loggerInstance;
}

// Helper for Lambda execution context
export function setLambdaContext(
  requestId: string,
  functionName: string,
  functionVersion: string
): void {
  const logger = getLogger();
  logger.setContext({
    aws_request_id: requestId,
    function_name: functionName,
    function_version: functionVersion,
  });
}
