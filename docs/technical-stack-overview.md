# Sibyl PoC -- Technical Stack Overview

**Audience:** Developers, technical product managers, or senior engineers joining the project. Assumes familiarity with AWS service names (Lambda, SQS, DynamoDB, IAM) but not with this specific system.

**Scope:** End-to-end PoC architecture -- infrastructure, processing pipelines, AI integrations, storage, UI, and shared utilities. Covers what each component is, how it connects to adjacent pieces, and why it was configured the way it is.

**Last verified against source:** 2026-03-05

---

## Table of Contents

1. [System Overview](#system-overview)
2. [End-to-End Data Flow](#end-to-end-data-flow)
3. [Infrastructure -- AWS CDK](#infrastructure----aws-cdk)
4. [Text Processing Pipeline](#text-processing-pipeline)
5. [Video Processing Pipeline](#video-processing-pipeline)
6. [AI Services](#ai-services)
7. [Storage -- DynamoDB](#storage----dynamodb)
8. [Secrets Management](#secrets-management)
9. [Cost Tracking](#cost-tracking)
10. [Monitoring and Alarms](#monitoring-and-alarms)
11. [UI -- Next.js App Router](#ui----nextjs-app-router)
12. [Taxonomy](#taxonomy)
13. [Shared Utilities](#shared-utilities)
14. [Key Trade-offs](#key-trade-offs)

---

## System Overview

Sibyl is an AI-powered content tagging system. It takes media content (articles, archived JSON records, podcasts, videos), sends it to an LLM, and gets back a set of standardised taxonomy tags with confidence scores. Tags above 85% confidence are auto-published; tags below that threshold route the item to a human review queue.

The PoC processes content through two parallel pipelines -- one for text (articles, JSON, podcasts) using Claude on AWS Bedrock, and one for video using Google Gemini. Both pipelines write results to the same DynamoDB table, and both apply the same confidence-based routing logic.

---

## End-to-End Data Flow

```
                                    SUBMIT
                                      |
                      +---------------+----------------+
                      |                                |
                 Text content                    Video content
                      |                                |
                      v                                v
              +---------------+              +------------------+
              |  SQS: text    |              |   S3 Bucket      |
              |  processing   |              | (pre-signed PUT) |
              +-------+-------+              +--------+---------+
                      |                                |
                      |                       +--------v---------+
                      |                       |  SQS: video      |
                      |                       |  processing      |
                      |                       +--------+---------+
                      |                                |
                      v                                v
           +------------------+             +-------------------+
           | Lambda: text     |             | Lambda: video     |
           | processor        |             | processor         |
           |                  |             |                   |
           | 1. Parse message |             | 1. Parse message  |
           | 2. Load taxonomy |             | 2. Download from  |
           | 3. Build prompt  |             |    S3             |
           | 4. Call Bedrock  |             | 3. Upload to      |
           |    (Claude)      |             |    Gemini File API|
           | 5. Validate tags |             | 4. Poll ACTIVE    |
           | 6. Route by      |             | 5. generateContent|
           |    confidence    |             | 6. Validate tags  |
           +--------+---------+             | 7. Route by       |
                    |                       |    confidence     |
                    |                       +--------+----------+
                    |                                |
                    +---------------+----------------+
                                    |
                                    v
                        +-----------+-----------+
                        |    DynamoDB           |
                        |    sibyl-content-tags  |
                        |                       |
                        |  status: complete     |
                        |    OR needs_review    |
                        +-----------+-----------+
                                    |
                       +------------+-------------+
                       |                          |
                       v                          v
                Auto-published              Human Review UI
                (status=complete)           (needs_review=true)
```

**Failure path (both pipelines):**

```
  Lambda fails processing
         |
         v
  SQS re-delivers message (up to 3 attempts)
         |
         v (still failing)
  Dead Letter Queue (shared DLQ)
  sibyl-tagging-dlq-dev
  Retained 14 days for investigation
         |
         v
  CloudWatch Alarm fires at >= 10 DLQ messages
```

---

## Infrastructure -- AWS CDK

All AWS resources are defined as infrastructure-as-code using AWS CDK (Cloud Development Kit) in TypeScript.

| Aspect | Detail |
|--------|--------|
| **CDK stack file** | `/Users/matthewrance/Documents/Sibyl/poc/infrastructure/stacks/content-tagging-stack.ts` |
| **Language** | TypeScript |
| **Deploy command** | `npm run build && npm run cdk:deploy` |
| **Environment** | Parameterised via CDK context (`environment` defaults to `dev`) |

Running `cdk deploy` synthesises a CloudFormation template from the TypeScript definition and deploys all resources in one command. The infrastructure is version-controlled alongside application code, repeatable, and can be torn down and rebuilt from scratch.

**Resources created by the stack:**

- 2 DynamoDB tables (tags + cost tracking)
- 1 S3 bucket (video uploads)
- 3 SQS queues (text, video, shared DLQ)
- 2 Lambda functions (text processor, video processor)
- 1 SNS topic (alarm notifications)
- 5 CloudWatch alarms
- 1 CloudWatch dashboard
- IAM roles and policies (least-privilege)

---

## Text Processing Pipeline

### Entry Point: SQS Queue

| Setting | Value | Why |
|---------|-------|-----|
| **Queue name** | `sibyl-text-processing-dev` | |
| **Type** | Standard (not FIFO) | Order does not matter for tagging. Standard queues offer higher throughput and lower cost. |
| **Visibility timeout** | 180 seconds | Must exceed Lambda timeout (30s) by a comfortable margin. AWS recommends >= 6x. If the Lambda takes longer than expected, the message stays invisible long enough to avoid duplicate processing. |
| **Message retention** | 4 days | Messages persist if the Lambda is unavailable or backed up. |
| **DLQ** | `sibyl-tagging-dlq-dev` (shared) | After 3 failed processing attempts, the message moves to the DLQ instead of retrying forever. |
| **Max receive count** | 3 | Three chances to process before DLQ routing. |

**Why SQS?** It decouples the UI/ingest layer from the processing layer. The submitter gets an immediate acknowledgement and does not wait for AI processing to complete. If the Lambda is unavailable, messages queue up and process when capacity returns.

### Consumer: Lambda -- Text Processor

| Setting | Value |
|---------|-------|
| **Function name** | `sibyl-text-processor-dev` |
| **Source** | `/Users/matthewrance/Documents/Sibyl/poc/src/lambdas/text-processor/index.ts` |
| **Runtime** | Node.js 20.x |
| **Memory** | 512 MB |
| **Timeout** | 30 seconds |
| **Trigger** | SQS event source mapping (AWS manages the polling -- the Lambda does not poll SQS itself) |
| **Batch size** | 10 messages per invocation, with 5-second batching window |
| **Batch item failure reporting** | Enabled -- only successfully processed messages are deleted from the queue |
| **X-Ray tracing** | Active |
| **Log retention** | 1 week |

**What it does, step by step:**

1. **Parse** -- Receives SQS event containing one or more records. Each record body is a JSON payload with `content_id`, `content_type`, `title`, `body_text`, and a `trace_id`.
2. **Validate** -- Parses the payload against a Zod schema (`SQSMessagePayloadSchema`). Invalid messages fail immediately and will eventually route to the DLQ.
3. **Load taxonomy** -- Reads the taxonomy from a bundled JSON file (injected at build time via CDK `afterBundling` hook -- see [Taxonomy](#taxonomy) section).
4. **Build prompt** -- Constructs the three-layer prompt: system prompt (Layer 1) + content-type instructions (Layer 2) + taxonomy + content body (Layer 3). Body text is truncated at 32,000 characters (~8k tokens) for cost control.
5. **Call Bedrock** -- Invokes the Claude model via the Bedrock `InvokeModel` API. The call is wrapped in a **circuit breaker** (opens after 5 consecutive failures, resets after 60s) and **retry with exponential backoff** (3 attempts, starting at 1s, retries on `ThrottlingException` and `ServiceUnavailable`).
6. **Parse response** -- Extracts the JSON tag array from Claude's response.
7. **Validate tags** -- Checks every returned tag against the taxonomy. Tags not in the taxonomy are logged as `HALLUCINATION DETECTED` and dropped. This is the hard safety net: the AI must never introduce tags outside the controlled vocabulary.
8. **Route by confidence** -- Applies the 0.85 confidence threshold. If any tag on the item is below 85%, the item is flagged `needs_review = true`. If all tags are >= 85%, `needs_review = false`.
9. **Write to DynamoDB** -- Stores the full result (tags, confidence scores, routing decision, processing metadata) in the `sibyl-content-tags-dev` table.
10. **Track cost** -- Writes a separate record to the cost tracking table with model, token counts, computed USD cost, and latency.

**Key environment variables:**

| Variable | Purpose |
|----------|---------|
| `BEDROCK_MODEL_ID` | Cross-region inference profile ID |
| `TAGS_TABLE_NAME` | DynamoDB table for tagging results |
| `COST_TABLE_NAME` | DynamoDB table for cost metrics |
| `CONFIDENCE_THRESHOLD` | 0.85 -- the auto-publish cutoff |
| `BEDROCK_MOCK_ENABLED` | `false` in deployed stack; `true` short-circuits the Bedrock API call for local testing |
| `CIRCUIT_BREAKER_THRESHOLD` | 5 failures before circuit opens |
| `CIRCUIT_BREAKER_TIMEOUT` | 60,000 ms before circuit half-opens |

---

## Video Processing Pipeline

### Entry Point: S3 Bucket

| Setting | Value | Why |
|---------|-------|-----|
| **Bucket name** | `sibyl-content-uploads-dev-{accountId}` | Account ID suffix ensures global uniqueness. |
| **Lifecycle rule** | Objects expire after 7 days | Video files are ephemeral -- they only need to exist long enough for processing. |
| **CORS** | PUT from `localhost:3000` and `https://*` | Allows browser-based direct upload. |
| **Block public access** | All public access blocked | Files are only accessible via pre-signed URLs or IAM-authenticated calls. |
| **Auto-delete on stack destroy** | Enabled | PoC convenience -- production would retain. |

**Upload flow:** The UI calls `POST /api/upload`, which generates a temporary S3 pre-signed PUT URL. The browser uploads the video file directly to S3 using that URL. The video never passes through the web server -- this avoids request size limits and keeps the Next.js server lightweight.

### Entry Point: SQS Queue

| Setting | Value | Why |
|---------|-------|-----|
| **Queue name** | `sibyl-video-processing-dev` | |
| **Visibility timeout** | 1,800 seconds (30 minutes) | Video processing is slow. Gemini file upload, polling to ACTIVE state, and the generateContent call can take several minutes for large videos. The visibility timeout must exceed the Lambda timeout (300s) by a safe margin. |
| **Message retention** | 4 days | |
| **DLQ** | `sibyl-tagging-dlq-dev` (shared with text) | Same DLQ as text pipeline -- keeps operational simplicity for PoC. |
| **Max receive count** | 3 | |

### Consumer: Lambda -- Video Processor

| Setting | Value |
|---------|-------|
| **Function name** | `sibyl-video-processor-dev` |
| **Source** | `/Users/matthewrance/Documents/Sibyl/poc/src/lambdas/video-processor/index.ts` |
| **Runtime** | Node.js 20.x |
| **Memory** | 3,008 MB (3 GB) |
| **Timeout** | 300 seconds (5 minutes) |
| **Trigger** | SQS event source mapping, batch size 1 |
| **X-Ray tracing** | Active |
| **Log retention** | 1 week |

**Why 3 GB memory?** The Lambda downloads the entire video file from S3 into a Buffer before uploading to Gemini. A video file can be hundreds of megabytes; 3 GB provides headroom for the file buffer plus Node.js runtime overhead.

**Why batch size 1?** Video processing is resource-intensive and time-consuming. Processing one video per invocation isolates failures and avoids Lambda timeout issues from serialising multiple large videos.

**What it does, step by step:**

1. **Parse** -- Same SQS payload parsing as text, but expects `content_url` (S3 path) instead of `body_text`.
2. **Validate video format** -- Checks the file extension is a supported type (mp4, mov, avi).
3. **Compute frame samples** -- Based on video duration and the configured sampling interval (default: 1 frame every 15 seconds), generates a list of timestamps to analyse.
4. **Download from S3** -- Streams the video bytes from S3 into a Buffer. Determines MIME type from file extension.
5. **Upload to Gemini File API** -- Sends the video bytes via multipart upload to Gemini's file upload endpoint. This is an external HTTPS call to `generativelanguage.googleapis.com`.
6. **Poll until ACTIVE** -- Gemini processes the uploaded file asynchronously. The Lambda polls every 2 seconds until the file state is `ACTIVE` (ready for analysis) or times out after 120 seconds.
7. **Call generateContent** -- Sends a single multimodal request containing the file reference and a tagging prompt. Gemini analyses the video frames and returns per-timestamp tags.
8. **Delete Gemini file** -- Best-effort cleanup. The uploaded file is deleted from Gemini after processing. If deletion fails, it is logged but does not fail the pipeline.
9. **Aggregate frame tags** -- Per-frame tags are aggregated to video-level tags. A tag must appear in >= 20% of sampled frames to be included.
10. **Validate, route, store, track** -- Same taxonomy validation, confidence routing, DynamoDB write, and cost tracking as the text pipeline.

**Additional environment variables (beyond shared):**

| Variable | Purpose |
|----------|---------|
| `GEMINI_API_KEY_SSM_PATH` | SSM parameter path for the Gemini API key |
| `GEMINI_API_URL` | `https://generativelanguage.googleapis.com` |
| `GEMINI_MOCK_ENABLED` | `false` in deployed stack |
| `FRAME_SAMPLING_INTERVAL` | 15 seconds between sampled frames |
| `S3_CONTENT_BUCKET` | Bucket name for video downloads |

---

## AI Services

### AWS Bedrock -- Claude (Text Tagging)

| Aspect | Detail |
|--------|--------|
| **Model** | `us.anthropic.claude-sonnet-4-20250514-v1:0` |
| **Type** | Cross-region inference profile |
| **Routing regions** | us-east-1, us-east-2, us-west-2 |
| **API** | Bedrock `InvokeModel` (synchronous -- Lambda waits for the response) |
| **Resilience** | Circuit breaker (5 failures / 60s reset) + retry with exponential backoff (3 attempts) |

**Cross-region inference profiles** are an AWS Bedrock feature where the service automatically routes your request to whichever region has available capacity. If us-east-1 is busy, the request may go to us-east-2 or us-west-2 instead. From the Lambda's perspective, it calls one endpoint; AWS handles the routing.

**IAM requirement:** The Lambda's IAM policy must grant `bedrock:InvokeModel` on both the inference profile ARN (account-scoped, in the deployment region) and the foundation model ARN in every region the profile may route to. This is a common gotcha -- if you miss a region, the request works sometimes and fails intermittently when routed to the unpermitted region.

**Prompt structure:**

| Layer | Goes into | Content | Changes per |
|-------|-----------|---------|-------------|
| Layer 1 (System) | Claude `system` field | Role definition, output format (JSON), taxonomy constraints, confidence scoring guide, 3-10 tag limit | Never (stable) |
| Layer 2 (Content-type) | User message (first section) | Content-type-specific tagging instructions. Articles scan 8 dimensions; podcasts scan 10 (most aggressive -- they tend to cover multiple topics per episode); video focuses on visual analysis; JSON focuses on structured data signals | Per content type |
| Layer 3 (Runtime) | User message (second section) | Full taxonomy text + content title + body text (truncated at 32,000 chars) + maxTags parameter | Per request |

Source: `/Users/matthewrance/Documents/Sibyl/poc/src/lambdas/text-processor/prompts.ts`

### Google Gemini (Video Tagging)

| Aspect | Detail |
|--------|--------|
| **Model** | `gemini-2.5-flash` |
| **API** | Gemini REST API (File API for upload, `generateContent` for analysis) |
| **Authentication** | API key (stored in AWS SSM Parameter Store, fetched at Lambda cold start, cached in-memory) |
| **Genuinely multimodal** | Analyses visual content across video frames -- not just reading a transcript or looking at a thumbnail |

**Why Gemini for video?** At the time of architecture selection, Gemini offered the most mature multimodal video analysis capability accessible via API. It can process a full video file and reason about what is happening visually across frames, which is fundamentally different from (and more capable than) audio transcription or frame-by-frame image classification.

**Trade-off: two AI providers.** Using both Bedrock (Claude) and Gemini means two API integrations, two sets of credentials, two cost models, and two failure modes to monitor. The benefit is best-in-class capability for each content type. An AWS-only alternative (Claude Vision via Bedrock) is being evaluated to determine whether the operational simplicity of a single provider outweighs any capability difference. This decision depends on PoC results.

**File lifecycle on Gemini:**

```
Upload video bytes --> Gemini stores file --> poll until ACTIVE --> generateContent --> delete file
```

The file is ephemeral. It exists in Gemini only for the duration of processing. Deletion is best-effort; if it fails, the file is not accessible to other users (it is scoped to the API key).

Source: `/Users/matthewrance/Documents/Sibyl/poc/src/lambdas/video-processor/gemini-client.ts`

---

## Storage -- DynamoDB

### Tags Table: `sibyl-content-tags-dev`

| Setting | Value | Why |
|---------|-------|-----|
| **Partition key** | `content_id` (String) | Unique content identifier |
| **Sort key** | `content_type` (String) | Allows the same content_id to exist with different types (uncommon, but handles edge cases) |
| **Billing** | PAY_PER_REQUEST (on-demand) | No capacity planning needed at PoC scale. Pay only for what you use. |
| **Streams** | NEW_AND_OLD_IMAGES | Enabled for future event-driven extensions (e.g. Azure sync, real-time tag index) |
| **TTL** | 1-year retention (set per item) | Items auto-expire to prevent unbounded table growth during PoC |
| **Point-in-time recovery** | Dev: off, Prod: on | |
| **Removal policy** | Dev: DESTROY, Prod: RETAIN | Dev stack can be torn down cleanly; prod preserves data |

**Item shape:**

```json
{
  "content_id": "article-12345",
  "content_type": "article",
  "title": "Best Grilling Techniques for Summer",
  "status": "completed",
  "tags": [
    { "tag": "grilling-recipes", "confidence": 0.95, "reasoning": "..." },
    { "tag": "outdoor-cooking", "confidence": 0.88, "reasoning": "..." }
  ],
  "needs_review": "false",
  "source": "ai",
  "reviewed": false,
  "routing_metadata": {
    "routing_reason": "all_above_threshold",
    "confidence_threshold": 0.85,
    "min_confidence": 0.88
  },
  "processing_metadata": {
    "model_used": "us.anthropic.claude-sonnet-4-20250514-v1:0",
    "processing_time_ms": 2340,
    "token_count": 1542,
    "cost_usd": 0.0089,
    "retry_count": 0
  },
  "created_at": "2026-03-05T14:23:00.000Z",
  "updated_at": "2026-03-05T14:23:00.000Z",
  "ttl": 1741186980
}
```

**Global Secondary Indexes (GSIs):**

| Index name | Partition key | Sort key | Purpose |
|------------|--------------|----------|---------|
| `status-index` | `status` | `created_at` | Query all items with a given status (e.g. all completed items) |
| `content-type-index` | `content_type` | `created_at` | Filter items by content type (articles, podcasts, etc.) |
| `needs-review-index` | `needs_review` | `created_at` | Powers the human review queue. Sparse: only items with `needs_review = "true"` appear. Projection: ALL attributes. |

### Cost Table: `sibyl-processing-costs-dev`

| Setting | Value |
|---------|-------|
| **Partition key** | `pk` (String, format: `CONTENT#{content_id}`) |
| **Sort key** | `sk` (String, format: `PROCESSING#{timestamp}`) |
| **Billing** | PAY_PER_REQUEST |
| **TTL** | 90 days |
| **Removal policy** | DESTROY |

Every processed item writes a cost record containing: model used, processing time, token counts, computed USD cost, and status. These records auto-expire after 90 days -- cost data is diagnostic, not archival.

---

## Secrets Management

| Secret | Storage | Access |
|--------|---------|--------|
| **Gemini API key** | SSM Parameter Store, SecureString (KMS-encrypted), path `/sibyl/dev/gemini-api-key` | Video Lambda fetches at cold start via `GetParameter` with `WithDecryption: true`, then caches in-memory for the Lambda lifecycle |
| **Bedrock credentials** | IAM role attached to Lambda | No secret to manage -- the Lambda's execution role has `bedrock:InvokeModel` permission |
| **DynamoDB credentials** | IAM role attached to Lambda | Same -- no secret to manage |
| **UI AWS credentials** | `.env.local` (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) | PoC-only approach. Production would use IAM roles (e.g. via ECS task role or Lambda@Edge). |

**No secrets are hardcoded.** Lambda environment variables carry only non-sensitive configuration (table names, queue URLs, model IDs, feature flags). Actual secrets are fetched at runtime from SSM.

---

## Cost Tracking

Cost tracking is built in from day one to avoid surprises during the PoC.

**How it works:**

1. After every AI call, the Lambda computes the USD cost using `MetricsCollector.calculateCost()` -- a static method with hardcoded per-model pricing tables for Bedrock and Gemini models.
2. The cost record is written to the cost tracking DynamoDB table.
3. Writes are fire-and-forget -- if cost tracking fails, it does not fail the tagging pipeline. The `MetricsCollector` catches errors and logs a warning.

**Pricing table** (from `/Users/matthewrance/Documents/Sibyl/poc/src/shared/utils/metrics.ts`):

| Model | Input (per 1K tokens) | Output (per 1K tokens) |
|-------|----------------------|------------------------|
| Claude Sonnet 4 (Bedrock) | $0.003 | $0.015 |
| Gemini 1.5 Flash | $0.000075 | $0.0003 |

**Design note:** This is intentionally simple for the PoC. Production would likely use CloudWatch Custom Metrics or a dedicated observability platform for cost tracking, with alarms on spend thresholds.

---

## Monitoring and Alarms

The CDK stack deploys a CloudWatch dashboard (`sibyl-tagging-dev`) and five alarms, all routed to an SNS topic.

### Alarms

| Alarm | Trigger | Why it matters |
|-------|---------|---------------|
| **DLQ depth** | >= 10 messages in the DLQ | Items are failing repeatedly. Indicates a systemic issue (API down, permission error, bad data). |
| **Text processor errors** | > 10 errors in a 5-minute window (2 consecutive periods) | High absolute error count. |
| **Text processor error rate** | > 5% error rate over 15 minutes | Catches degradation even at low volume. |
| **Text processor throttles** | > 5 throttles in 5 minutes | Lambda concurrency limit hit -- need to increase or investigate. |
| **Daily cost** | > $10/day (dev) or $100/day (prod) | Cost runaway protection. |

### Dashboard Widgets

- Alarm status summary
- DLQ depth (current + trend)
- Daily processing cost (USD)
- Items processed (last 24h)
- Items processed per hour (text vs. video)
- Error rate (%) over time
- Lambda duration p95 (text vs. video)
- DLQ depth trend

---

## UI -- Next.js App Router

| Aspect | Detail |
|--------|--------|
| **Location** | `/Users/matthewrance/Documents/Sibyl/poc/ui/` |
| **Framework** | Next.js 14, App Router |
| **Styling** | Tailwind CSS |
| **Deployment** | Local development server (not yet deployed to AWS) |

### Pages

| Page | URL | Purpose |
|------|-----|---------|
| Submit | `/` | Paste text or upload video for tagging |
| Review | `/review` | Human review queue -- items below 85% confidence |
| Explorer | `/explorer` | Browse tagged content, filter by tag or content type, view related content |
| Taxonomy | `/taxonomy` | Browse the full taxonomy tree |

### API Routes

All API routes are server-side Next.js route handlers. They call AWS services directly using the AWS SDK v3.

| Route | Method | What it does |
|-------|--------|--------------|
| `/api/submit` | POST | Validates input, writes message to the appropriate SQS queue (text or video based on content type) |
| `/api/upload` | POST | Generates an S3 pre-signed PUT URL for video upload. The browser uploads directly to S3. |
| `/api/results/[contentId]` | GET | Fetches a single item from DynamoDB by `content_id` |
| `/api/queue` | GET | Queries the `needs-review-index` GSI to list items awaiting human review |
| `/api/explorer` | GET | Queries DynamoDB, filters by tag(s) and/or content_type. Filtering is done in-memory after the query. |
| `/api/explorer/[contentId]/related` | GET | Fetches all completed items, computes Jaccard similarity against the target item, returns top N related items |
| `/api/taxonomy` | GET | Reads and returns the taxonomy JSON |
| `/api/review/[contentId]/approve` | POST | Saves human-reviewed/approved tags back to DynamoDB |

**DynamoDB access from the UI:** API routes use `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` with credentials from `.env.local`. This is a PoC convenience -- production would use IAM roles.

### Related Content Scoring

Source: `/Users/matthewrance/Documents/Sibyl/poc/ui/lib/relatedness.ts`

The related content feature uses **Jaccard similarity** -- a simple set-overlap metric:

```
Jaccard(A, B) = |tags(A) intersection tags(B)| / |tags(A) union tags(B)|
```

| Score range | Strength label |
|-------------|---------------|
| >= 0.40 | Strong |
| 0.20 -- 0.39 | Moderate |
| 0.05 -- 0.19 | Weak |
| < 0.05 | Excluded (not shown) |

**Trade-off:** At PoC scale, the algorithm fetches all completed items from DynamoDB and computes similarity in memory. This does not scale to 775k items. Production would need a tag-based inverted index or a dedicated search service. For the PoC (hundreds to low thousands of items), in-memory computation is fast and avoids premature infrastructure complexity.

---

## Taxonomy

| Aspect | Detail |
|--------|--------|
| **File** | `/Users/matthewrance/Documents/Sibyl/data/taxonomy/taxonomy-v1.json` |
| **Version** | v2.0.0 |
| **Tags** | 1,542 across 6 verticals |
| **Verticals** | Food & Cooking, Home & Garden, Parenting & Family, Entertainment, Automotive, History & Biography |
| **Structure** | Verticals -> categories -> tags. Only leaf-node tags are valid tag names. Vertical and category names are organisational headings, never used as tags. |

**How it reaches the Lambda:**

The taxonomy JSON is bundled into the Lambda deployment package at build time. The CDK stack's `afterBundling` hook copies the file into the Lambda's output directory:

```
/data/taxonomy/taxonomy-v1.json  -->  {lambda-output}/data/taxonomy/taxonomy-v1.json
```

At runtime, the Lambda reads the file from disk (effectively just `require` or `readFileSync` on a local file). There is no network call, no S3 fetch, no DynamoDB lookup.

**Why bundle instead of fetching at runtime?**

- Zero latency: no network call during the hot path
- No dependency on an external service at tag time
- Simpler error handling (file is guaranteed to exist if Lambda deployed successfully)

**Trade-off:** Taxonomy updates require a Lambda redeploy (code change, build, `cdk deploy`). At PoC scale, taxonomy changes are infrequent and this is acceptable. Production may want a more dynamic mechanism (e.g. S3 with a short cache TTL), but that adds latency and a failure mode.

---

## Shared Utilities

Located at `/Users/matthewrance/Documents/Sibyl/poc/src/shared/`. These are used by both Lambda functions.

### `config/index.ts`

- Reads all environment variables and exposes a typed `AppConfig` object.
- Validates required config at Lambda cold start (`validateConfig()`).
- Default values are PoC-appropriate (e.g. `maxRetries: 3`, `confidenceThreshold: 0.85`).

### `utils/logger.ts`

- Structured JSON logger. Outputs one JSON object per log line, compatible with CloudWatch Insights.
- Supports log levels (DEBUG, INFO, WARN, ERROR) and contextual fields (`trace_id`, `content_id`, `content_type`).
- Lambda context (request ID, function name, version) is set at the start of each invocation.
- Singleton pattern -- one logger instance per Lambda lifecycle.

### `utils/metrics.ts`

- `MetricsCollector` class. Writes cost/performance records to the cost DynamoDB table.
- `MetricsCollector.calculateCost()` -- static method with hardcoded per-model pricing. Used by both Lambdas to compute USD cost from token counts.
- Writes are non-blocking: if cost tracking fails, the tagging pipeline continues.
- 90-day TTL on all records.

### `types/index.ts` + `types/content.ts` + `types/taxonomy.ts`

- Shared TypeScript types: `ContentType` enum (ARTICLE, JSON, PODCAST, VIDEO), `TagResult`, `ProcessingStatus`, `SQSMessagePayload` (with Zod schema for runtime validation), and custom error types (`ValidationError`, `ProcessingError`, `CircuitBreakerError`).

### Taxonomy loader, circuit breaker, retry utility

- **Taxonomy loader** (`utils/taxonomy-loader.ts`): Loads the bundled taxonomy, formats it for prompt injection, and provides `validateTags()` for hallucination detection.
- **Circuit breaker** (`utils/circuit-breaker.ts` or similar): Opens after N consecutive failures, rejects calls immediately for a timeout period, then half-opens to test recovery.
- **Retry with backoff** (`utils/retry.ts` or similar): Retries failed operations with exponential delay. Configurable per-operation: text retries on `ThrottlingException`/`ServiceUnavailable`; video retries on network errors (`ECONNRESET`, `ETIMEDOUT`).

---

## Key Trade-offs

These are architectural decisions made for the PoC with awareness of their limitations.

| Decision | Benefit | Limitation | Production path |
|----------|---------|------------|-----------------|
| **Taxonomy bundled in Lambda** | Zero-latency reads, no external dependency | Updates require redeploy | S3 with cache, or parameter store |
| **In-memory filtering and related content** | Simple, no extra infrastructure | Does not scale past a few thousand items | Tag inverted index or search service (e.g. OpenSearch) |
| **Shared DLQ for text and video** | Simpler to monitor and alarm on | Cannot distinguish text vs. video failures without inspecting message body | Separate DLQs per content type |
| **Two AI providers (Bedrock + Gemini)** | Best-in-class per content type | Two integrations, two credential sets, two cost models | Evaluate Claude Vision via Bedrock as single-provider alternative; decide based on PoC quality comparison |
| **UI credentials in .env.local** | Fast PoC setup | Not suitable for production | IAM roles (ECS task role, Lambda@Edge, or Cognito) |
| **Cost tracking in DynamoDB** | Simple, same tech stack, no extra service | No aggregation, no dashboards built-in | CloudWatch Custom Metrics or observability platform |
| **PAY_PER_REQUEST DynamoDB billing** | No capacity planning, no wasted capacity | More expensive per-request than provisioned at high volumes | Switch to provisioned capacity with auto-scaling at production load |
| **Hardcoded model pricing in MetricsCollector** | No external dependency for cost calculation | Prices go stale as providers update pricing | Fetch pricing from API or config, or use AWS Cost Explorer for Bedrock |
