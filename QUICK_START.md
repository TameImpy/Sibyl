# Quick Start Guide

Get the PoC running in 15 minutes.

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity`)
- Node.js 20.x installed (`node --version`)
- Bedrock access enabled (us-east-1 region)

## 5-Step Deployment

### 1. Install Dependencies (2 min)

```bash
cd /Users/matthewrance/Documents/Sibyl/poc
npm install
```

### 2. Build TypeScript (1 min)

```bash
npm run build
```

### 3. Bootstrap CDK - First Time Only (2 min)

```bash
# Replace ACCOUNT-ID with your AWS account ID
cdk bootstrap aws://ACCOUNT-ID/us-east-1

# Example:
# cdk bootstrap aws://123456789012/us-east-1
```

### 4. Deploy Infrastructure (5 min)

```bash
npm run cdk:deploy
```

Save the outputs:
```
SibylTagging-dev.TextQueueUrl = https://sqs.us-east-1.amazonaws.com/.../sibyl-text-processing-dev
SibylTagging-dev.TagsTableName = sibyl-content-tags-dev
```

### 5. Send Test Message (1 min)

```bash
# Use helper script
./examples/send-test-message.sh dev article

# Or manually send via AWS CLI
TEXT_QUEUE_URL="<URL_FROM_OUTPUTS>"

aws sqs send-message \
  --queue-url $TEXT_QUEUE_URL \
  --message-body '{
    "content": {
      "content_id": "550e8400-e29b-41d4-a716-446655440000",
      "content_type": "article",
      "content_text": "This slow cooker guide covers making tender pulled pork, beef stew, and chicken dishes. Perfect for meal prep and batch cooking.",
      "metadata": {
        "title": "Slow Cooker Guide"
      }
    },
    "attempt": 1,
    "max_attempts": 3,
    "trace_id": "test-001"
  }'
```

## Verify It Works

### Watch Processing (real-time)

```bash
aws logs tail /aws/lambda/sibyl-text-processor-dev --follow
```

Expected log output:
```json
{
  "timestamp": "2026-02-20T12:34:56.789Z",
  "level": "INFO",
  "message": "Processing text content",
  "context": {
    "content_id": "550e8400-e29b-41d4-a716-446655440000",
    "content_type": "article"
  }
}
```

### Check Results (after 10-20 seconds)

```bash
aws dynamodb get-item \
  --table-name sibyl-content-tags-dev \
  --key '{
    "content_id": {"S": "550e8400-e29b-41d4-a716-446655440000"},
    "content_type": {"S": "article"}
  }'
```

Expected output:
```json
{
  "Item": {
    "content_id": {"S": "550e8400-e29b-41d4-a716-446655440000"},
    "status": {"S": "completed"},
    "tags": {
      "L": [
        {
          "M": {
            "tag": {"S": "slow-cooker-meals"},
            "confidence": {"N": "0.95"}
          }
        }
      ]
    }
  }
}
```

## Common Commands

### Deploy
```bash
npm run cdk:deploy
```

### Preview Changes
```bash
cdk diff
```

### View Logs
```bash
aws logs tail /aws/lambda/sibyl-text-processor-dev --follow
```

### Check Queue Depth
```bash
aws sqs get-queue-attributes \
  --queue-url <QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages
```

### Check DLQ (Failed Messages)
```bash
# Get DLQ URL from outputs
aws sqs receive-message \
  --queue-url <DLQ_URL> \
  --max-number-of-messages 10
```

### Destroy Everything
```bash
cdk destroy
```

## Troubleshooting

### "AccessDeniedException: You don't have access to the model"

**Solution**: Enable Bedrock access
1. AWS Console → Amazon Bedrock → Model access
2. Request access to Claude 3 Haiku
3. Wait ~30 seconds for approval

### "No messages being processed"

**Check**:
1. Queue has messages: `aws sqs get-queue-attributes ...`
2. Lambda errors: `aws logs tail ...`
3. Lambda is enabled: `aws lambda get-function --function-name sibyl-text-processor-dev`

### "Deployment failed"

**Check**:
1. AWS CLI is configured: `aws sts get-caller-identity`
2. CDK is bootstrapped: `cdk bootstrap ...`
3. IAM permissions: Need CloudFormation, Lambda, SQS, DynamoDB, IAM permissions

## Next Steps

- Read README.md for full documentation
- Read ARCHITECTURE.md for design details
- Read DEPLOYMENT.md for production deployment
- See examples/test-messages.json for more test cases

## Cost Estimate

PoC testing (100 articles):
- Bedrock: ~$0.12
- Lambda: ~$0.002
- SQS: ~$0.0001
- DynamoDB: ~$0.001
- **Total: ~$0.12**

Daily usage (1000 articles):
- ~$1.20/day

## Support

- CloudWatch Logs: Check for errors first
- AWS Bedrock Docs: https://docs.aws.amazon.com/bedrock/
- CDK Docs: https://docs.aws.amazon.com/cdk/

---

**Time to first successful tagging**: < 15 minutes from zero to deployed and processing content.
