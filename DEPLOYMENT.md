# Deployment Guide

## Prerequisites Checklist

- [ ] Node.js 20.x installed (`node --version`)
- [ ] AWS CLI installed and configured (`aws --version`)
- [ ] AWS CDK CLI installed (`cdk --version`)
- [ ] AWS credentials configured (`aws sts get-caller-identity`)
- [ ] Bedrock access enabled in your AWS account (us-east-1)
- [ ] Appropriate IAM permissions for CDK deployment

## First-Time Setup

### 1. Request Bedrock Access

If you haven't already, request access to Claude models:

```bash
# Navigate to AWS Console → Amazon Bedrock → Model access
# Request access to:
# - Claude 3 Haiku
# - Claude 3 Sonnet (optional, for higher quality)
```

Access is typically granted within minutes.

### 2. Clone and Install

```bash
cd /Users/matthewrance/Documents/Sibyl/poc
npm install
```

### 3. Build TypeScript

```bash
npm run build
```

### 4. Bootstrap CDK (One-Time Per Account/Region)

```bash
# Bootstrap CDK in your AWS account and region
cdk bootstrap aws://ACCOUNT-ID/us-east-1

# Example:
cdk bootstrap aws://123456789012/us-east-1
```

**What does bootstrap do?**
- Creates S3 bucket for CDK assets
- Creates IAM roles for CloudFormation
- Creates ECR repositories for Docker images (if needed)

### 5. Review Stack Before Deploy

```bash
# See what will be created
cdk diff

# Generate CloudFormation template
npm run cdk:synth
```

### 6. Deploy

```bash
# Deploy to dev environment (default)
npm run cdk:deploy

# Deploy to prod environment
cdk deploy --context environment=prod --context region=us-east-1
```

**Expected deployment time:** 3-5 minutes

### 7. Save Outputs

After deployment, CDK will output important values:

```
Outputs:
SibylTagging-dev.TextQueueUrl = https://sqs.us-east-1.amazonaws.com/.../sibyl-text-processing-dev
SibylTagging-dev.VideoQueueUrl = https://sqs.us-east-1.amazonaws.com/.../sibyl-video-processing-dev
SibylTagging-dev.TagsTableName = sibyl-content-tags-dev
SibylTagging-dev.TagsTableStreamArn = arn:aws:dynamodb:...
```

**Save these values** - you'll need them for testing and integration.

## Environment-Specific Deployments

### Development Environment

```bash
cdk deploy --context environment=dev
```

**Configuration:**
- Reserved Lambda concurrency: 10
- Cost alarm threshold: $10/day
- DynamoDB: On-demand billing
- Point-in-time recovery: Disabled
- DLQ retention: 14 days

### Production Environment

```bash
cdk deploy --context environment=prod --require-approval broadening
```

**Configuration:**
- Reserved Lambda concurrency: 100
- Cost alarm threshold: $100/day
- DynamoDB: On-demand billing
- Point-in-time recovery: Enabled
- DLQ retention: 14 days
- **Important:** Use `--require-approval broadening` to review IAM changes

## Post-Deployment Configuration

### 1. Configure SNS Alarm Notifications

```bash
# Get the alarm topic ARN from stack outputs
TOPIC_ARN=$(aws cloudformation describe-stacks \
  --stack-name sibyl-tagging-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AlarmTopicArn`].OutputValue' \
  --output text)

# Subscribe your email
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint ops@example.com

# Confirm subscription via email
```

### 2. Store Gemini API Key (If Using Video Processing)

```bash
# Store API key in SSM Parameter Store
aws ssm put-parameter \
  --name /sibyl/dev/gemini-api-key \
  --value "YOUR_GEMINI_API_KEY_HERE" \
  --type SecureString \
  --description "Gemini API key for video tagging" \
  --region us-east-1

# Verify it was stored
aws ssm get-parameter \
  --name /sibyl/dev/gemini-api-key \
  --with-decryption \
  --query 'Parameter.Value' \
  --output text
```

### 3. Enable Video Processing (Optional)

Video processing is disabled by default. To enable:

```typescript
// In infrastructure/stacks/content-tagging-stack.ts
// Update sharedEnv:
ENABLE_VIDEO_PROCESSING: 'true',
```

Then redeploy:

```bash
cdk deploy
```

## Testing Deployment

### 1. Send Test Message to Text Queue

```bash
# Get queue URL
TEXT_QUEUE_URL=$(aws cloudformation describe-stacks \
  --stack-name sibyl-tagging-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`TextQueueUrl`].OutputValue' \
  --output text)

# Send test message
aws sqs send-message \
  --queue-url $TEXT_QUEUE_URL \
  --message-body '{
    "content": {
      "content_id": "550e8400-e29b-41d4-a716-446655440000",
      "content_type": "article",
      "content_text": "This comprehensive guide covers everything about slow cooker meals. Learn how to make tender, flavorful dishes with minimal effort. Perfect for busy weeknight dinners and meal prep. Includes recipes for pulled pork, beef stew, and chicken dishes.",
      "metadata": {
        "title": "Ultimate Slow Cooker Guide",
        "author": "Test User",
        "published_date": "2026-02-20T12:00:00Z"
      },
      "processing_config": {
        "priority": "normal",
        "max_tags": 10
      }
    },
    "attempt": 1,
    "max_attempts": 3,
    "trace_id": "'$(uuidgen)'"
  }'
```

### 2. Monitor Processing

```bash
# Watch Lambda logs
aws logs tail /aws/lambda/sibyl-text-processor-dev --follow

# Check if message was processed (wait 10-20 seconds)
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
    "content_type": {"S": "article"},
    "status": {"S": "completed"},
    "tags": {"L": [...]},
    "processing_metadata": {...},
    "created_at": {"S": "2026-02-20T12:34:56.789Z"}
  }
}
```

### 3. Verify Cost Tracking

```bash
# Check cost table
aws dynamodb scan \
  --table-name sibyl-processing-costs-dev \
  --max-items 5
```

### 4. Test Error Handling

Send an invalid message to test DLQ:

```bash
# Send invalid message (missing required fields)
aws sqs send-message \
  --queue-url $TEXT_QUEUE_URL \
  --message-body '{"invalid": "message"}'

# Wait a few seconds, then check DLQ
DLQ_URL=$(aws cloudformation describe-stacks \
  --stack-name sibyl-tagging-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`DLQUrl`].OutputValue' \
  --output text)

aws sqs receive-message \
  --queue-url $DLQ_URL \
  --max-number-of-messages 1
```

## Updating Deployment

### Code Changes

```bash
# 1. Make code changes
# 2. Build TypeScript
npm run build

# 3. Deploy (only changed resources will update)
npm run cdk:deploy
```

### Infrastructure Changes

```bash
# 1. Edit infrastructure/stacks/content-tagging-stack.ts
# 2. Preview changes
cdk diff

# 3. Deploy
npm run cdk:deploy
```

### Rollback

If deployment fails or introduces issues:

```bash
# CloudFormation automatically rolls back on failure
# To manually rollback to previous version:
aws cloudformation rollback-stack --stack-name sibyl-tagging-dev

# Or delete and redeploy
cdk destroy
cdk deploy
```

## Destroying Infrastructure

**Warning:** This will delete all resources including data in DynamoDB.

```bash
# Destroy dev environment
cdk destroy --context environment=dev

# Force destroy without confirmation
cdk destroy --force
```

**Note:** Resources with `RETAIN` removal policy (e.g., prod DynamoDB tables) will not be deleted.

## Troubleshooting

### CDK Bootstrap Failed

**Error:** "Unable to resolve AWS account to use"

**Solution:**
```bash
# Configure AWS credentials
aws configure

# Or use environment variables
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
```

### Deployment Failed - IAM Permissions

**Error:** "User is not authorized to perform: cloudformation:CreateStack"

**Solution:** Your IAM user/role needs these permissions:
- `cloudformation:*`
- `s3:*` (for CDK assets)
- `iam:CreateRole`, `iam:AttachRolePolicy`, etc.
- `lambda:*`
- `sqs:*`
- `dynamodb:*`

### Bedrock Access Denied

**Error:** "AccessDeniedException: You don't have access to the model"

**Solution:**
1. Go to AWS Console → Amazon Bedrock → Model access
2. Request access to Claude 3 Haiku
3. Wait for approval (usually instant)
4. Verify with:
```bash
aws bedrock list-foundation-models --region us-east-1
```

### Lambda Function Not Processing Messages

**Possible causes:**
1. SQS event source not configured (check CloudFormation)
2. Lambda has errors (check CloudWatch Logs)
3. Circuit breaker is OPEN (check logs for "Circuit breaker OPEN")
4. IAM permissions missing (check Lambda execution role)

**Debug:**
```bash
# Check Lambda errors
aws lambda get-function-configuration \
  --function-name sibyl-text-processor-dev

# Check SQS event source
aws lambda list-event-source-mappings \
  --function-name sibyl-text-processor-dev

# Invoke Lambda manually
aws lambda invoke \
  --function-name sibyl-text-processor-dev \
  --payload file://test-event.json \
  response.json
```

## Best Practices

1. **Always preview changes:** Run `cdk diff` before deploying
2. **Use environment context:** Keep dev/prod separate
3. **Monitor after deploy:** Watch CloudWatch logs for 5-10 minutes
4. **Test incrementally:** Send 1 message, verify, then scale up
5. **Set up alarms:** Configure SNS email notifications immediately
6. **Tag resources:** CDK automatically tags, but add custom tags if needed
7. **Version control:** Commit CDK code before deploying
8. **Document changes:** Update README with any custom configurations

## Deployment Checklist

Pre-deployment:
- [ ] Code builds without errors (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] Preview changes (`cdk diff`)
- [ ] Review IAM permissions changes
- [ ] Check cost implications

Post-deployment:
- [ ] Verify stack creation completed successfully
- [ ] Save CloudFormation outputs
- [ ] Send test message
- [ ] Verify message processed successfully
- [ ] Check CloudWatch logs
- [ ] Verify cost tracking works
- [ ] Test error handling (DLQ)
- [ ] Configure alarm notifications
- [ ] Update documentation with any custom settings

## Support

For AWS-specific issues:
- AWS Support Console
- AWS Forums
- Stack Overflow (tag: amazon-web-services, aws-cdk)

For project-specific issues:
- Check CloudWatch logs first
- Review ARCHITECTURE.md for design context
- Check GitHub issues (if using version control)
