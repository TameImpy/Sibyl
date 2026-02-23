import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getLogger } from './logger';

const logger = getLogger();

// Metric types for cost and performance tracking
export interface ProcessingMetrics {
  content_id: string;
  content_type: string;
  model_used: string;
  processing_time_ms: number;
  token_count?: number;
  cost_usd?: number;
  status: string;
  timestamp: string;
  error_type?: string;
}

export interface CostMetrics {
  date: string; // YYYY-MM-DD
  model: string;
  content_type: string;
  request_count: number;
  total_tokens: number;
  total_cost_usd: number;
  average_latency_ms: number;
}

/**
 * Metrics collector for tracking costs and performance
 *
 * Best practice: Track costs from day 1 to avoid surprises.
 * This implementation uses DynamoDB for simple PoC tracking.
 * In production, consider using CloudWatch Custom Metrics or a proper observability platform.
 */
export class MetricsCollector {
  private dynamoClient: DynamoDBDocumentClient;
  private costTableName: string;
  private enabled: boolean;

  constructor(costTableName: string, enabled: boolean = true) {
    this.costTableName = costTableName;
    this.enabled = enabled;

    const client = new DynamoDBClient({});
    this.dynamoClient = DynamoDBDocumentClient.from(client);
  }

  /**
   * Track processing metrics for a single content item
   */
  async trackProcessing(metrics: ProcessingMetrics): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.costTableName,
          Item: {
            pk: `CONTENT#${metrics.content_id}`,
            sk: `PROCESSING#${metrics.timestamp}`,
            ...metrics,
            ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days retention
          },
        })
      );

      logger.debug('Processing metrics tracked', {
        content_id: metrics.content_id,
        cost_usd: metrics.cost_usd,
        processing_time_ms: metrics.processing_time_ms,
      });
    } catch (error) {
      // Don't fail the request if metrics fail
      logger.warn('Failed to track processing metrics', {}, error as Error);
    }
  }

  /**
   * Calculate cost based on model pricing
   * Prices as of Jan 2025 (verify current pricing)
   */
  static calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Bedrock pricing per 1000 tokens
    const pricing: Record<string, { input: number; output: number }> = {
      'anthropic.claude-3-haiku-20240307-v1:0': { input: 0.00025, output: 0.00125 },
      'anthropic.claude-3-sonnet-20240229-v1:0': { input: 0.003, output: 0.015 },
      'anthropic.claude-3-5-sonnet-20240620-v1:0': { input: 0.003, output: 0.015 },
      'anthropic.claude-3-5-sonnet-20241022-v2:0': { input: 0.003, output: 0.015 },
      'gemini-1.5-flash': { input: 0.000075, output: 0.0003 },
      'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
    };

    const modelPricing = pricing[model] || { input: 0.001, output: 0.002 }; // Default fallback

    const inputCost = (inputTokens / 1000) * modelPricing.input;
    const outputCost = (outputTokens / 1000) * modelPricing.output;

    return inputCost + outputCost;
  }

  /**
   * Emit CloudWatch custom metric
   * Note: This requires CloudWatch PutMetricData permissions
   */
  static emitCloudWatchMetric(
    metricName: string,
    value: number,
    unit: string,
    dimensions?: Record<string, string>
  ): void {
    // For PoC, just log the metric
    // In production, use CloudWatch SDK to publish
    logger.info('Metric emitted', {
      metric_name: metricName,
      value,
      unit,
      dimensions,
    });
  }
}

// Singleton instance
let metricsCollectorInstance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!metricsCollectorInstance) {
    const costTableName = process.env.COST_TABLE_NAME || 'processing-costs';
    const enabled = process.env.COST_TRACKING_ENABLED !== 'false';
    metricsCollectorInstance = new MetricsCollector(costTableName, enabled);
  }
  return metricsCollectorInstance;
}
