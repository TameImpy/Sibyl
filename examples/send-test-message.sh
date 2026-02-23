#!/bin/bash
# Script to send test messages to SQS queues
# Usage: ./send-test-message.sh [environment] [content_type]
# Example: ./send-test-message.sh dev article

set -e

ENVIRONMENT=${1:-dev}
CONTENT_TYPE=${2:-article}

echo "Sending test message to $ENVIRONMENT environment for $CONTENT_TYPE content..."

# Get queue URL from CloudFormation outputs
if [ "$CONTENT_TYPE" == "video" ]; then
  QUEUE_URL=$(aws cloudformation describe-stacks \
    --stack-name sibyl-tagging-$ENVIRONMENT \
    --query 'Stacks[0].Outputs[?OutputKey==`VideoQueueUrl`].OutputValue' \
    --output text)
else
  QUEUE_URL=$(aws cloudformation describe-stacks \
    --stack-name sibyl-tagging-$ENVIRONMENT \
    --query 'Stacks[0].Outputs[?OutputKey==`TextQueueUrl`].OutputValue' \
    --output text)
fi

if [ -z "$QUEUE_URL" ]; then
  echo "Error: Could not find queue URL. Is the stack deployed?"
  exit 1
fi

echo "Queue URL: $QUEUE_URL"

# Generate UUID for content_id and trace_id
CONTENT_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
TRACE_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Sample content based on type
if [ "$CONTENT_TYPE" == "article" ]; then
  CONTENT_TEXT="This comprehensive guide covers everything about slow cooker meals. Learn how to make tender, flavorful dishes with minimal effort. Perfect for busy weeknight dinners and meal prep. Includes recipes for pulled pork, beef stew, and chicken dishes with detailed instructions."
  TITLE="Ultimate Slow Cooker Guide"
elif [ "$CONTENT_TYPE" == "video" ]; then
  CONTENT_TEXT=""
  TITLE="Air Fryer Cooking Basics Video"
else
  CONTENT_TEXT="Sample content for $CONTENT_TYPE type."
  TITLE="Test Content"
fi

# Create message payload
MESSAGE=$(cat <<EOF
{
  "content": {
    "content_id": "$CONTENT_ID",
    "content_type": "$CONTENT_TYPE",
    "content_text": "$CONTENT_TEXT",
    "metadata": {
      "title": "$TITLE",
      "author": "Test User",
      "published_date": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    },
    "processing_config": {
      "priority": "normal",
      "max_tags": 10
    }
  },
  "attempt": 1,
  "max_attempts": 3,
  "trace_id": "$TRACE_ID"
}
EOF
)

echo "Sending message with content_id: $CONTENT_ID"
echo "Trace ID: $TRACE_ID"

# Send message to SQS
aws sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body "$MESSAGE"

echo "Message sent successfully!"
echo ""
echo "To monitor processing:"
echo "  aws logs tail /aws/lambda/sibyl-text-processor-$ENVIRONMENT --follow"
echo ""
echo "To check results:"
echo "  aws dynamodb get-item --table-name sibyl-content-tags-$ENVIRONMENT --key '{\"content_id\": {\"S\": \"$CONTENT_ID\"}, \"content_type\": {\"S\": \"$CONTENT_TYPE\"}}'"
