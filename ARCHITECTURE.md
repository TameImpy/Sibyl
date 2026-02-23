# Architecture Documentation

## System Overview

The Intelligent Content Tagging System is a serverless, event-driven pipeline for automatically tagging content using AI models. It processes text (articles, JSON, podcasts) and video content, assigning relevant tags from a predefined taxonomy.

## Design Principles

1. **Serverless-First**: Leverage managed services to minimize operational overhead
2. **Fail-Safe**: Circuit breakers and retries prevent cascading failures
3. **Cost-Aware**: Track costs from day 1, set hard limits via reserved concurrency
4. **Observable**: Structured logging, X-Ray tracing, CloudWatch alarms
5. **Scalable**: Event-driven architecture scales automatically with load
6. **Decoupled**: SQS queues decouple producers from consumers

## Component Architecture

### 1. Ingress Layer (Not Yet Implemented)

Future component for content submission:
- API Gateway with Lambda authorizer
- S3 bucket for large content uploads
- EventBridge for scheduled batch processing

### 2. Queueing Layer

**SQS Queues:**
- `text-processing-queue`: Handles articles, JSON, podcasts
- `video-processing-queue`: Handles video content
- `dead-letter-queue`: Captures failed messages after max retries

**Queue Configuration:**
- Visibility timeout: 6x Lambda timeout (prevents duplicate processing)
- Max receive count: 3 (send to DLQ after 3 failures)
- Message retention: 4 days
- Encryption: AWS-managed keys

**Why SQS?**
- Decouples ingress from processing
- Built-in retry mechanism
- DLQ for failure handling
- No message loss during Lambda failures

### 3. Processing Layer

#### Text Processor Lambda

**Purpose:** Process text content using Claude on Amazon Bedrock

**Configuration:**
- Runtime: Node.js 20.x
- Memory: 512 MB (sufficient for text processing)
- Timeout: 30 seconds
- Batch size: 10 messages (parallel processing)
- Reserved concurrency: 10 (dev), 100 (prod)

**Why these settings?**
- 512 MB: Balances cost vs performance for text
- 30s timeout: Bedrock typically responds in 2-5s, leaves buffer for retries
- Batch size 10: Maximizes throughput without overwhelming Bedrock
- Reserved concurrency: Prevents runaway costs from infinite scaling

**Processing Flow:**
1. Receive batch of messages from SQS
2. For each message:
   - Validate schema with Zod
   - Check circuit breaker state
   - Call Bedrock API with retry logic
   - Parse tags from response
   - Store results in DynamoDB
   - Track cost metrics
3. Return batch item failures to SQS for retry

#### Video Processor Lambda

**Purpose:** Process video content using Gemini API

**Configuration:**
- Runtime: Node.js 20.x
- Memory: 1024 MB (video metadata can be large)
- Timeout: 30 seconds
- Batch size: 1 message (videos are expensive)
- Reserved concurrency: 5 (dev), 50 (prod)

**Why these settings?**
- 1024 MB: Video processing may require more memory
- Batch size 1: Process videos sequentially to avoid API rate limits
- Lower concurrency: External API, want to control request rate

**Note:** For production, consider moving to ECS for long-running video analysis tasks.

### 4. Storage Layer

#### DynamoDB Tables

**Tags Table:**
- Partition key: `content_id` (UUID)
- Sort key: `content_type` (article, video, etc.)
- GSI: `status-index` for querying by processing status
- TTL enabled: Auto-delete old records
- Streams enabled: For future Azure sync

**Why DynamoDB?**
- Single-digit millisecond latency
- Automatic scaling with on-demand billing
- Streams for change data capture
- TTL for automatic data lifecycle management

**Cost Table:**
- Partition key: `pk` (CONTENT#{content_id})
- Sort key: `sk` (PROCESSING#{timestamp})
- TTL: 90 days retention
- Purpose: Track processing costs per content item

**Why separate cost table?**
- Avoids bloating main table
- Can be queried independently for cost analysis
- Lower importance (ephemeral data)

#### RDS PostgreSQL (Not Yet Implemented)

**Purpose:** Store taxonomy data and cache

**Planned Schema:**
```sql
CREATE TABLE taxonomy_versions (
  id UUID PRIMARY KEY,
  version VARCHAR(20) NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tag_mappings (
  id SERIAL PRIMARY KEY,
  tag VARCHAR(100) NOT NULL,
  vertical VARCHAR(50) NOT NULL,
  category VARCHAR(100) NOT NULL,
  taxonomy_version VARCHAR(20) NOT NULL,
  UNIQUE(tag, taxonomy_version)
);
```

**Why RDS?**
- Relational taxonomy structure fits SQL
- JSONB for flexible schema
- ACID guarantees for taxonomy updates
- Can use RDS Proxy for Lambda connection pooling

### 5. AI Integration

#### Amazon Bedrock (Claude)

**Model Selection:**
- Default: Claude 3 Haiku (cost-effective)
- Optional: Claude 3 Sonnet (higher quality, 10x cost)

**API Pattern:**
```typescript
{
  anthropic_version: "bedrock-2023-05-31",
  max_tokens: 2048,
  temperature: 0.3,  // Lower = more consistent
  messages: [...]
}
```

**Circuit Breaker:**
- Threshold: 5 failures
- Timeout: 60 seconds
- States: CLOSED → OPEN → HALF_OPEN

**Why circuit breaker?**
- Prevents hammering Bedrock during outages
- Fails fast instead of wasting Lambda time
- Automatically recovers when service is healthy

#### Gemini API (Video)

**Model:** Gemini 1.5 Flash (multimodal)

**API Key Management:**
- Stored in SSM Parameter Store (encrypted)
- Cached in Lambda for performance
- Retrieved once per cold start

**Why external API?**
- Bedrock doesn't yet support all video features
- Can switch to AWS-only stack later (feature flag)

### 6. Observability

#### Structured Logging

**Format:**
```json
{
  "timestamp": "2026-02-20T12:34:56.789Z",
  "level": "INFO",
  "message": "Processing text content",
  "context": {
    "trace_id": "uuid",
    "content_id": "uuid",
    "content_type": "article",
    "attempt": 1
  }
}
```

**Why structured logs?**
- Query with CloudWatch Insights
- Track requests across services
- Correlate errors with trace_id

#### CloudWatch Alarms

**Critical Alarms:**
1. DLQ depth > 0 (failures occurring)
2. Lambda errors > 10 per 5 min
3. Lambda throttles > 5 per 5 min
4. Daily cost exceeds budget

**Why these metrics?**
- DLQ: Immediate visibility into failures
- Errors: Detect code bugs or API issues
- Throttles: Capacity planning signal
- Cost: Prevent bill shock

#### X-Ray Tracing

- Enabled on all Lambdas
- Traces SQS → Lambda → Bedrock → DynamoDB
- Useful for debugging latency issues

### 7. Error Handling

#### Retry Strategy

**Exponential Backoff:**
```
Attempt 1: 1s + jitter
Attempt 2: 2s + jitter
Attempt 3: 4s + jitter
```

**Retryable Errors:**
- ThrottlingException
- ServiceUnavailable
- RequestTimeout
- Network errors

**Non-Retryable:**
- ValidationException
- AccessDeniedException
- Invalid input

#### Dead Letter Queue

**When messages reach DLQ:**
- Exceeded 3 SQS receive attempts
- Lambda throws non-retryable error
- Circuit breaker opens (message returned to queue, eventually DLQ)

**DLQ Processing:**
- Manual review required
- Can replay messages after fix
- Retention: 14 days

### 8. Cost Optimization

#### Strategies

1. **Model Selection:** Default to Haiku (10x cheaper than Sonnet)
2. **Reserved Concurrency:** Hard limit on parallel executions
3. **Batch Processing:** Process multiple messages per Lambda invocation
4. **On-Demand Pricing:** Pay only for what you use (PoC phase)
5. **TTL:** Auto-delete old DynamoDB records

#### Cost Tracking

Every request tracked:
- Content ID
- Model used
- Token count
- Estimated cost
- Processing time

**Query daily costs:**
```bash
aws dynamodb query \
  --table-name sibyl-processing-costs-dev \
  --key-condition-expression "pk = :date" \
  --expression-attribute-values '{":date": {"S": "DATE#2026-02-20"}}'
```

## Data Flow

### Text Processing Flow

```
1. Content ingress (future: API Gateway)
   ↓
2. Message sent to text-processing-queue
   ↓
3. SQS triggers text-processor Lambda
   ↓
4. Lambda validates message (Zod schema)
   ↓
5. Check circuit breaker state
   ↓
6. Call Bedrock API with retry
   ↓
7. Parse tags from response
   ↓
8. Store in DynamoDB tags table
   ↓
9. Track metrics in cost table
   ↓
10. Return success to SQS (message deleted)
```

### Error Flow

```
1. Lambda throws error
   ↓
2. SQS makes message visible again
   ↓
3. Message reprocessed (attempt 2)
   ↓
4. Still fails (attempt 3)
   ↓
5. Max receive count exceeded
   ↓
6. Message sent to DLQ
   ↓
7. CloudWatch alarm triggers
   ↓
8. SNS notification sent
```

## Scalability Considerations

### Current Limits (PoC)

- Lambda concurrency: 10 (dev), 100 (prod)
- Text batch size: 10 messages
- Video batch size: 1 message
- SQS message retention: 4 days

### Scaling to Production

**10,000 articles/day:**
- Lambda invocations: ~1,000 (batch size 10)
- Bedrock requests: ~10,000
- Est. cost: ~$11/day + Lambda/SQS costs
- Required concurrency: ~10-20

**100,000 articles/day:**
- Lambda invocations: ~10,000
- Bedrock requests: ~100,000
- Est. cost: ~$113/day
- Required concurrency: ~50-100
- Consider: Bedrock quotas, may need increase

**Bottlenecks:**
1. Bedrock rate limits (request quota increase)
2. Lambda concurrency (increase reserved concurrency)
3. DynamoDB throughput (on-demand scales automatically)

## Security

### Secrets Management

- Gemini API key: SSM Parameter Store (encrypted)
- RDS password: SSM Parameter Store (future)
- No secrets in environment variables
- No secrets in code

### IAM Permissions

**Text Processor:**
- `bedrock:InvokeModel` (specific models only)
- `dynamodb:PutItem` (tags and cost tables)
- `sqs:ReceiveMessage, DeleteMessage` (text queue)
- `logs:CreateLogGroup, PutLogEvents`
- `xray:PutTraceSegments`

**Video Processor:**
- `ssm:GetParameter` (Gemini API key only)
- `dynamodb:PutItem`
- `sqs:ReceiveMessage, DeleteMessage` (video queue)
- Same logging/tracing permissions

**Principle:** Least privilege - only what's needed, nothing more.

### Network Security

- Lambdas in default VPC (public subnet for Bedrock/Gemini access)
- SQS encryption: AWS-managed keys
- DynamoDB encryption: AWS-managed keys
- Future RDS: Private subnet, no public access

## Future Enhancements

1. **RDS Integration:** Taxonomy caching and versioning
2. **ECS for Video:** Long-running video analysis tasks
3. **Azure Sync:** DynamoDB Stream → Lambda → Azure Data Warehouse
4. **S3 Content Fetch:** Large content stored in S3
5. **API Gateway:** REST API for content submission
6. **Batch Processing:** EventBridge scheduled jobs
7. **A/B Testing:** Compare model performance
8. **Taxonomy Updates:** Blue/green deployment for taxonomy changes

## References

- AWS Well-Architected Framework: https://aws.amazon.com/architecture/well-architected/
- Lambda Best Practices: https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html
- DynamoDB Best Practices: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/best-practices.html
- Bedrock Documentation: https://docs.aws.amazon.com/bedrock/
