import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';

const region = process.env.AWS_REGION ?? 'us-east-1';

// Singletons — reused across requests in the same Lambda execution context
const dynamodbClient = new DynamoDBClient({ region });
export const docClient = DynamoDBDocumentClient.from(dynamodbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const sqsClient = new SQSClient({ region });

export const TAGS_TABLE_NAME = process.env.TAGS_TABLE_NAME ?? 'sibyl-content-tags-dev';
export const TEXT_QUEUE_URL = process.env.TEXT_QUEUE_URL ?? '';
export const VIDEO_QUEUE_URL = process.env.VIDEO_QUEUE_URL ?? '';
