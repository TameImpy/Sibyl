# Sibyl Tagging System — Monitoring & Observability

## Log Format

All Lambda functions emit structured JSON logs via `src/shared/utils/logger.ts`. Every log line is a single JSON object on stdout, which CloudWatch Logs automatically indexes for CloudWatch Insights.

### Standard Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO 8601 string | Log emission time |
| `level` | `DEBUG` \| `INFO` \| `WARN` \| `ERROR` | Severity |
| `message` | string | Human-readable description |
| `context.aws_request_id` | string | Lambda request ID (set at invocation) |
| `context.function_name` | string | Lambda function name |
| `context.function_version` | string | Lambda function version |
| `context.trace_id` | string | SQS message trace ID (set per record) |
| `context.content_id` | string | Content item being processed |
| `context.content_type` | `article` \| `json_record` \| `podcast` \| `video` | Content type |
| `context.attempt` | number | SQS delivery attempt number |
| `error.message` | string | Error message (ERROR/WARN only) |
| `error.name` | string | Error class name |
| `error.stack` | string | Full stack trace |

### Example: Successful Processing

```json
{
  "timestamp": "2024-01-15T10:23:45.123Z",
  "level": "INFO",
  "message": "Text content processed successfully",
  "context": {
    "aws_request_id": "abc-123",
    "function_name": "sibyl-text-processor-dev",
    "function_version": "$LATEST",
    "trace_id": "trc-xyz-789",
    "content_id": "article-456",
    "content_type": "article",
    "attempt": 1,
    "tag_count": 5,
    "needs_review": "false",
    "processing_time_ms": 2340,
    "cost_usd": 0.000312
  }
}
```

### Example: Hallucination Detected

```json
{
  "timestamp": "2024-01-15T10:23:45.200Z",
  "level": "WARN",
  "message": "HALLUCINATION DETECTED: Claude returned tags not in taxonomy",
  "context": {
    "trace_id": "trc-xyz-789",
    "content_id": "article-456",
    "invalid_tags": ["gluten-free-baking", "artisan-bread"],
    "model": "anthropic.claude-3-5-sonnet-20241022-v2:0"
  }
}
```

### Example: Processing Failure

```json
{
  "timestamp": "2024-01-15T10:23:46.000Z",
  "level": "ERROR",
  "message": "Failed to process text content",
  "context": {
    "trace_id": "trc-xyz-789",
    "content_id": "article-456",
    "processing_time_ms": 5012
  },
  "error": {
    "message": "Circuit breaker is OPEN for bedrock",
    "name": "CircuitBreakerError",
    "stack": "CircuitBreakerError: Circuit breaker is OPEN for bedrock\n    at ..."
  }
}
```

---

## CloudWatch Insights Queries

Run these in the CloudWatch Insights console. Select the relevant log group:
- `/aws/lambda/sibyl-text-processor-dev` (or `-prod`)
- `/aws/lambda/sibyl-video-processor-dev` (or `-prod`)

### 1. Processing Success Rate (last 24 hours)

```
fields @timestamp, context.content_id, context.processing_time_ms
| filter message = "Text content processed successfully"
| stats count() as successful by bin(1h)
```

### 2. Error Rate by Error Type

```
fields @timestamp, error.name, error.message, context.content_id
| filter level = "ERROR"
| stats count() as error_count by error.name
| sort error_count desc
```

### 3. Daily Cost by Content Type

```
fields @timestamp, context.content_type, context.cost_usd
| filter message = "Text content processed successfully"
| stats sum(context.cost_usd) as total_cost_usd, count() as items_processed by context.content_type
| sort total_cost_usd desc
```

### 4. Average Processing Latency by Content Type

```
fields @timestamp, context.content_type, context.processing_time_ms
| filter message = "Text content processed successfully"
| stats avg(context.processing_time_ms) as avg_ms,
        pct(context.processing_time_ms, 95) as p95_ms,
        max(context.processing_time_ms) as max_ms
        by context.content_type
```

### 5. Hallucination Rate (invalid tags from Claude)

```
fields @timestamp, context.content_id, context.invalid_tags
| filter message like "HALLUCINATION DETECTED"
| stats count() as hallucination_events by bin(1h)
```

### 6. Items Routed to Human Review

```
fields @timestamp, context.content_id, context.routing_reason, context.min_confidence
| filter message = "Content routing decision" and context.needs_review = "true"
| sort @timestamp desc
| limit 50
```

### 7. Circuit Breaker Events

```
fields @timestamp, error.name, context.content_id
| filter error.name = "CircuitBreakerError"
| stats count() as circuit_open_rejections by bin(5m)
| sort @timestamp desc
```

### 8. Retry Activity

```
fields @timestamp, context.content_id, level, message
| filter message like "Retrying" or message like "retry"
| stats count() as retry_count by bin(1h)
```

### 9. Content Processing Volume (last 7 days)

```
fields @timestamp, context.content_type
| filter message = "Text content processed successfully"
| stats count() as items by context.content_type, bin(1d)
| sort @timestamp desc
```

### 10. Slowest Requests (P99 investigation)

```
fields @timestamp, context.content_id, context.content_type, context.processing_time_ms, context.cost_usd
| filter message = "Text content processed successfully"
| sort context.processing_time_ms desc
| limit 20
```

---

## Alarms

Alarms are defined in `infrastructure/stacks/content-tagging-stack.ts` and deployed via CDK.

| Alarm | Condition | Action |
|-------|-----------|--------|
| `sibyl-tagging-dlq-messages-{env}` | DLQ depth ≥ 10 | SNS notification |
| `sibyl-text-processor-errors-{env}` | Lambda error count ≥ 10 in 5 min | SNS notification |
| `sibyl-text-processor-error-rate-{env}` | Error rate > 5% over 15 min | SNS notification |
| `sibyl-tagging-daily-cost-{env}` | Daily cost > $10 (dev) / $100 (prod) | SNS notification |

---

## CloudWatch Dashboard

Dashboard name: **`sibyl-tagging-{env}`** (e.g. `sibyl-tagging-dev`)

**Access:** After `cdk deploy`, the dashboard URL is emitted as a CloudFormation output (`DashboardUrl`). Navigate directly to:
```
https://{region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=sibyl-tagging-{env}
```

### Dashboard Layout

**Row 1 — Headline numbers (single-value widgets)**

```
┌─────────────────────┬─────────────┬──────────────────────┬───────────────────────┐
│  Alarm Status       │  DLQ Depth  │  Daily Cost (USD)    │  Items Processed 24h  │
│  (4 alarms)         │  (max/5min) │  (custom metric)     │  (Lambda invocations) │
└─────────────────────┴─────────────┴──────────────────────┴───────────────────────┘
```

**Row 2 — Processing volume + error rate (graphs)**

```
┌──────────────────────────────────────┬────────────────────────────────────────┐
│  Items Processed per Hour            │  Error Rate (%)                        │
│  text-processor + video-processor    │  errors / invocations × 100            │
│  (sum, 1h period)                    │  (15-min period, alarm line at 5%)     │
└──────────────────────────────────────┴────────────────────────────────────────┘
```

**Row 3 — Latency + DLQ trend (graphs)**

```
┌──────────────────────────────────────┬────────────────────────────────────────┐
│  Lambda Duration p95 (ms)            │  DLQ Depth over time                   │
│  text-processor + video-processor    │  (max/5min)                            │
└──────────────────────────────────────┴────────────────────────────────────────┘
```

### Notes

- **Daily Processing Cost** uses the custom CloudWatch metric `Sibyl/Tagging/DailyProcessingCost`. In PoC mode `MetricsCollector` writes to DynamoDB rather than CloudWatch, so this widget will show no data until `MetricsCollector.emitCloudWatchMetric()` is wired to `CloudWatch.putMetricData` (Phase 1 task).
- All other metrics use built-in Lambda and SQS metrics — they populate automatically on first invocation.

---

## Log Retention

Lambda log groups are created automatically by AWS. Default retention is indefinite. For production, set retention via CDK:

```typescript
textProcessor.logGroup?.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
new logs.LogGroup(this, 'TextProcessorLogs', {
  logGroupName: `/aws/lambda/${textProcessor.functionName}`,
  retention: logs.RetentionDays.ONE_MONTH,
});
```

---

## Enabling Debug Logs

Set the `LOG_LEVEL` environment variable to `DEBUG` in the CDK stack or directly in the Lambda console:

```typescript
// In content-tagging-stack.ts sharedEnv:
LOG_LEVEL: 'DEBUG',
```

Debug logs include prompt layer sizes, token counts per call, and taxonomy validation detail.
