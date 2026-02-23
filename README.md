# Intelligent Content Tagging System - PoC

AI-powered content tagging pipeline using AWS Bedrock (Claude) for text and Gemini for video processing.

## Architecture

```
┌─────────────┐
│   Content   │
│   Ingress   │
└──────┬──────┘
       │
       ├──────────────┬──────────────┐
       │              │              │
       v              v              v
┌──────────┐   ┌──────────┐  ┌──────────┐
│ Text SQS │   │Video SQS │  │   DLQ    │
└────┬─────┘   └────┬─────┘  └──────────┘
     │              │
     v              v
┌─────────────┐ ┌──────────────┐
│   Lambda    │ │   Lambda     │
│Text Process │ │Video Process │
│  (Bedrock)  │ │  (Gemini)    │
└──────┬──────┘ └──────┬───────┘
       │              │
       └──────┬───────┘
              v
       ┌────────────┐
       │  DynamoDB  │
       │ Tags Table │
       └────────────┘
```

## Features

### Operational Excellence (Built-in from Day 1)
- **Circuit Breakers**: Prevent cascading failures to external APIs (Bedrock, Gemini)
- **Retry Logic**: Exponential backoff with jitter for transient failures
- **Dead Letter Queue**: Failed messages preserved for analysis
- **Cost Tracking**: Every request tracked with model, tokens, and estimated cost
- **Structured Logging**: JSON logs compatible with CloudWatch Insights
- **CloudWatch Alarms**: Monitor DLQ depth, error rates, throttling, and daily costs
- **X-Ray Tracing**: End-to-end request tracing enabled

### Content Processing
- **Text Content**: Articles, JSON, podcasts (pre-transcribed) via Claude on Bedrock
- **Video Content**: Processed via Gemini API (placeholder for multimodal)
- **Taxonomy**: 500 tags across 5 verticals (food, home, parenting, entertainment, automotive)
- **Validation**: Zod schemas for all inputs/outputs

## Project Structure

```
poc/
├── infrastructure/           # CDK infrastructure code
│   ├── app.ts               # CDK app entry point
│   └── stacks/
│       └── content-tagging-stack.ts  # Main stack with Lambda, SQS, DynamoDB
├── src/
│   ├── lambdas/
│   │   ├── text-processor/  # Text tagging with Bedrock
│   │   └── video-processor/ # Video tagging with Gemini
│   └── shared/
│       ├── types/           # TypeScript types and Zod schemas
│       ├── config/          # Environment configuration
│       └── utils/           # Logger, circuit breaker, metrics, retry
├── package.json
├── tsconfig.json
└── cdk.json
```

## Prerequisites

- Node.js 20.x or higher
- AWS CLI configured with credentials
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS Account with Bedrock access (us-east-1 region)

## Setup

### 1. Install Dependencies

```bash
cd /Users/matthewrance/Documents/Sibyl/poc
npm install
```

### 2. Bootstrap CDK (first time only)

```bash
cdk bootstrap aws://ACCOUNT-ID/us-east-1
```

### 3. Build TypeScript

```bash
npm run build
```

### 4. Deploy Infrastructure

```bash
# Deploy to dev environment
npm run cdk:deploy

# Or deploy to specific environment
cdk deploy --context environment=prod
```

### 5. Configure Secrets (for video processing)

```bash
# Store Gemini API key in SSM Parameter Store
aws ssm put-parameter \
  --name /sibyl/dev/gemini-api-key \
  --value "YOUR_GEMINI_API_KEY" \
  --type SecureString \
  --region us-east-1
```

## Usage

### Sending Test Messages

```bash
# Send text content for processing
aws sqs send-message \
  --queue-url <TEXT_QUEUE_URL> \
  --message-body '{
    "content": {
      "content_id": "550e8400-e29b-41d4-a716-446655440000",
      "content_type": "article",
      "content_text": "This slow cooker recipe makes tender, flavorful pulled pork...",
      "metadata": {
        "title": "Easy Slow Cooker Pulled Pork"
      }
    },
    "attempt": 1,
    "max_attempts": 3,
    "trace_id": "trace-001"
  }'
```

### Querying Results

```bash
# Get tagging results from DynamoDB
aws dynamodb get-item \
  --table-name sibyl-content-tags-dev \
  --key '{"content_id": {"S": "550e8400-e29b-41d4-a716-446655440000"}, "content_type": {"S": "article"}}'
```

### Monitoring

```bash
# View CloudWatch logs for text processor
aws logs tail /aws/lambda/sibyl-text-processor-dev --follow

# Check queue depth
aws sqs get-queue-attributes \
  --queue-url <TEXT_QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages

# Check DLQ for failed messages
aws sqs receive-message \
  --queue-url <DLQ_URL> \
  --max-number-of-messages 10
```

## Configuration

### Environment Variables

Key configurations set in CDK stack:

- `BEDROCK_MODEL_ID`: Claude model (default: haiku for cost)
- `MAX_TAGS_PER_CONTENT`: Maximum tags returned (default: 10)
- `CIRCUIT_BREAKER_THRESHOLD`: Failures before circuit opens (default: 5)
- `COST_TRACKING_ENABLED`: Enable cost tracking (default: true)
- `ENABLE_VIDEO_PROCESSING`: Enable video processing (default: false)

### Lambda Configuration

**Text Processor:**
- Memory: 512 MB
- Timeout: 30 seconds
- Batch size: 10 messages
- Reserved concurrency: 10 (dev), 100 (prod)

**Video Processor:**
- Memory: 1024 MB
- Timeout: 30 seconds
- Batch size: 1 message
- Reserved concurrency: 5 (dev), 50 (prod)

### Cost Controls

1. **Reserved Concurrency**: Hard limit on parallel executions
2. **CloudWatch Alarm**: Alert when daily cost exceeds threshold ($10 dev, $100 prod)
3. **Cost Tracking Table**: Every request logged with estimated cost
4. **Model Selection**: Default to Claude Haiku (most cost-effective)

## Development

### Run Tests

```bash
npm test
```

### Lint Code

```bash
npm run lint
```

### Format Code

```bash
npm run format
```

### Local Testing

```bash
# Run text processor locally with test event
npm run local:text
```

## Deployment Checklist

Before deploying to production:

- [ ] Update alarm notification email in stack
- [ ] Review and adjust reserved concurrency limits
- [ ] Set appropriate cost alarm thresholds
- [ ] Enable point-in-time recovery for DynamoDB (production only)
- [ ] Configure RDS PostgreSQL for taxonomy caching
- [ ] Set up DynamoDB Stream for Azure sync
- [ ] Review IAM permissions (least privilege)
- [ ] Enable AWS WAF if exposing API Gateway
- [ ] Document runbook for DLQ processing

## Cost Estimates (PoC)

Based on Claude Haiku pricing (Jan 2025):
- Input: $0.25 per 1M tokens
- Output: $1.25 per 1M tokens

Example costs per 1000 articles (avg 2000 tokens input, 500 tokens output):
- Input cost: 1000 * 2000 / 1,000,000 * $0.25 = $0.50
- Output cost: 1000 * 500 / 1,000,000 * $1.25 = $0.625
- **Total: ~$1.13 per 1000 articles**

Other costs:
- Lambda: ~$0.20 per 1M requests + $0.0000166667 per GB-second
- SQS: $0.40 per 1M requests
- DynamoDB: On-demand pricing, typically $0.25-1.25 per 1M requests

## Troubleshooting

### Messages stuck in queue
- Check Lambda CloudWatch logs for errors
- Verify circuit breaker hasn't opened (check logs for "Circuit breaker OPEN")
- Check DLQ for failed messages

### High costs
- Query cost tracking table to identify expensive content types
- Review CloudWatch metric: `Sibyl/Tagging/DailyProcessingCost`
- Consider switching to Haiku if using Sonnet

### Bedrock throttling
- Increase `CIRCUIT_BREAKER_THRESHOLD` if false positives
- Request service quota increase from AWS Support
- Reduce reserved concurrency to slow down request rate

## Next Steps

1. **RDS Integration**: Add PostgreSQL for taxonomy caching
2. **S3 Content Fetch**: Implement S3 content retrieval
3. **ECS Video Processing**: Move long-running video jobs to ECS
4. **Azure Sync**: Implement DynamoDB Stream → Azure Data Warehouse
5. **API Gateway**: Add REST API for content submission
6. **Taxonomy Updates**: Implement taxonomy versioning and updates

## Security

- All queues encrypted with AWS-managed keys
- Secrets stored in SSM Parameter Store (encrypted)
- IAM roles follow least-privilege principle
- No hardcoded credentials
- X-Ray tracing enabled for debugging (filter sensitive data)

## License

MIT
