import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import * as path from 'path';

export class ContentTaggingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || 'dev';

    // ==========================================
    // SNS Topic for Alarms
    // ==========================================
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Tagging System Alarms',
      topicName: `sibyl-tagging-alarms-${environment}`,
    });

    // Add email subscription (update with actual email)
    // alarmTopic.addSubscription(new sns_subscriptions.EmailSubscription('ops@example.com'));

    // ==========================================
    // DynamoDB Tables
    // ==========================================

    // Content tags table - stores tagging results
    const tagsTable = new dynamodb.Table(this, 'TagsTable', {
      tableName: `sibyl-content-tags-${environment}`,
      partitionKey: { name: 'content_id', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'content_type', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand for PoC
      timeToLiveAttribute: 'ttl',
      pointInTimeRecovery: environment === 'prod',
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For future Azure sync
    });

    // GSI for querying by status
    tagsTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
    });

    // GSI for querying by content_type (required per POC-001)
    tagsTable.addGlobalSecondaryIndex({
      indexName: 'content-type-index',
      partitionKey: { name: 'content_type', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
    });

    // GSI for review queue — sparse index: only items with needs_review = 'true' appear here
    // (POC-004: Confidence-Based Routing)
    tagsTable.addGlobalSecondaryIndex({
      indexName: 'needs-review-index',
      partitionKey: { name: 'needs_review', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'created_at', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Cost tracking table
    const costTable = new dynamodb.Table(this, 'CostTable', {
      tableName: `sibyl-processing-costs-${environment}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Cost data is ephemeral
    });

    // ==========================================
    // SQS Queues
    // ==========================================

    // Dead Letter Queue - all failed messages end up here
    const dlq = new sqs.Queue(this, 'DeadLetterQueue', {
      queueName: `sibyl-tagging-dlq-${environment}`,
      retentionPeriod: cdk.Duration.days(14), // Keep for 2 weeks for analysis
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Text processing queue
    const textQueue = new sqs.Queue(this, 'TextProcessingQueue', {
      queueName: `sibyl-text-processing-${environment}`,
      visibilityTimeout: cdk.Duration.seconds(180), // 6x Lambda timeout (30s)
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3, // After 3 attempts, send to DLQ
      },
    });

    // Video processing queue
    const videoQueue = new sqs.Queue(this, 'VideoProcessingQueue', {
      queueName: `sibyl-video-processing-${environment}`,
      visibilityTimeout: cdk.Duration.seconds(180),
      retentionPeriod: cdk.Duration.days(4),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
    });

    // ==========================================
    // Lambda Functions
    // ==========================================

    // Shared Lambda environment variables
    const sharedEnv = {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1', // Reuse HTTP connections
      TAGS_TABLE_NAME: tagsTable.tableName,
      COST_TABLE_NAME: costTable.tableName,
      TEXT_QUEUE_URL: textQueue.queueUrl,
      VIDEO_QUEUE_URL: videoQueue.queueUrl,
      DLQ_URL: dlq.queueUrl,
      BEDROCK_MODEL_ID: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      BEDROCK_REGION: 'us-east-1',
      LOG_LEVEL: 'info',
      ENABLE_STRUCTURED_LOGGING: 'true',
      COST_TRACKING_ENABLED: 'true',
      CIRCUIT_BREAKER_THRESHOLD: '5',
      CIRCUIT_BREAKER_TIMEOUT: '60000',
      ENABLE_VIDEO_PROCESSING: 'false', // Disable until Gemini integration ready
      BEDROCK_MOCK_ENABLED: 'true', // Remove when Bedrock access restored
      CONFIDENCE_THRESHOLD: '0.85', // Tags below this → needs_review: true (POC-004)
    };

    // Text processor Lambda
    const textProcessor = new nodejs.NodejsFunction(this, 'TextProcessor', {
      functionName: `sibyl-text-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/lambdas/text-processor/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 512, // 512MB for text processing
      reservedConcurrentExecutions: environment === 'prod' ? 100 : 10, // Prevent runaway costs
      environment: sharedEnv,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['aws-sdk'], // Use AWS SDK from Lambda runtime
        forceDockerBundling: false, // Use local bundling (no Docker required)
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      tracing: lambda.Tracing.ACTIVE, // Enable X-Ray tracing
    });

    // Video processor Lambda
    const videoProcessor = new nodejs.NodejsFunction(this, 'VideoProcessor', {
      functionName: `sibyl-video-processor-${environment}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../../src/lambdas/video-processor/index.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024, // 1GB for video metadata processing
      reservedConcurrentExecutions: environment === 'prod' ? 50 : 10,
      environment: {
        ...sharedEnv,
        GEMINI_API_KEY_SSM_PATH: `/sibyl/${environment}/gemini-api-key`,
        GEMINI_API_URL: 'https://generativelanguage.googleapis.com',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'es2022',
        externalModules: ['aws-sdk'],
        forceDockerBundling: false, // Use local bundling (no Docker required)
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
      tracing: lambda.Tracing.ACTIVE,
    });

    // ==========================================
    // IAM Permissions - Least Privilege
    // ==========================================

    // DynamoDB permissions
    tagsTable.grantReadWriteData(textProcessor);
    tagsTable.grantReadWriteData(videoProcessor);
    costTable.grantReadWriteData(textProcessor);
    costTable.grantReadWriteData(videoProcessor);

    // Bedrock permissions for text processor
    textProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: [
          `arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
        ],
      })
    );

    // SSM permissions for secrets (video processor needs Gemini API key)
    videoProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${this.region}:${this.account}:parameter/sibyl/${environment}/gemini-api-key`,
        ],
      })
    );

    // ==========================================
    // Event Sources
    // ==========================================

    // Connect SQS to Lambda
    textProcessor.addEventSource(
      new SqsEventSource(textQueue, {
        batchSize: 10, // Process up to 10 messages per invocation
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true, // Only delete successful messages
      })
    );

    videoProcessor.addEventSource(
      new SqsEventSource(videoQueue, {
        batchSize: 1, // Process videos one at a time
        maxBatchingWindow: cdk.Duration.seconds(0),
        reportBatchItemFailures: true,
      })
    );

    // ==========================================
    // CloudWatch Alarms
    // ==========================================

    // Alarm: DLQ has messages (something is failing repeatedly)
    const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: `sibyl-tagging-dlq-messages-${environment}`,
      alarmDescription: 'Messages in DLQ indicate processing failures',
      metric: dlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Alarm: Lambda errors exceed threshold
    const textProcessorErrorAlarm = new cloudwatch.Alarm(this, 'TextProcessorErrorAlarm', {
      alarmName: `sibyl-text-processor-errors-${environment}`,
      alarmDescription: 'Text processor error rate is high',
      metric: textProcessor.metricErrors({
        statistic: 'sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    textProcessorErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // Alarm: Lambda throttles (need more concurrency)
    const textProcessorThrottleAlarm = new cloudwatch.Alarm(this, 'TextProcessorThrottleAlarm', {
      alarmName: `sibyl-text-processor-throttles-${environment}`,
      alarmDescription: 'Text processor is being throttled',
      metric: textProcessor.metricThrottles({
        statistic: 'sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    textProcessorThrottleAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // ==========================================
    // Cost Monitoring
    // ==========================================

    // Create custom metric for daily processing cost
    const dailyCostMetric = new cloudwatch.Metric({
      namespace: 'Sibyl/Tagging',
      metricName: 'DailyProcessingCost',
      dimensionsMap: {
        Environment: environment,
      },
      statistic: 'sum',
      period: cdk.Duration.days(1),
    });

    // Alarm if daily cost exceeds budget (adjust threshold as needed)
    const costAlarm = new cloudwatch.Alarm(this, 'DailyCostAlarm', {
      alarmName: `sibyl-tagging-daily-cost-${environment}`,
      alarmDescription: 'Daily processing cost exceeds budget',
      metric: dailyCostMetric,
      threshold: environment === 'prod' ? 100 : 10, // $100 prod, $10 dev
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    costAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));

    // ==========================================
    // Outputs
    // ==========================================

    new cdk.CfnOutput(this, 'TextQueueUrl', {
      value: textQueue.queueUrl,
      description: 'Text processing queue URL',
      exportName: `sibyl-text-queue-url-${environment}`,
    });

    new cdk.CfnOutput(this, 'VideoQueueUrl', {
      value: videoQueue.queueUrl,
      description: 'Video processing queue URL',
      exportName: `sibyl-video-queue-url-${environment}`,
    });

    new cdk.CfnOutput(this, 'TagsTableName', {
      value: tagsTable.tableName,
      description: 'Tags table name',
      exportName: `sibyl-tags-table-name-${environment}`,
    });

    new cdk.CfnOutput(this, 'TagsTableStreamArn', {
      value: tagsTable.tableStreamArn || 'N/A',
      description: 'Tags table stream ARN for Azure sync',
      exportName: `sibyl-tags-stream-arn-${environment}`,
    });
  }
}
