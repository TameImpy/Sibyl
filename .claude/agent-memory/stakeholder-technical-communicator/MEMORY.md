# Stakeholder Technical Communicator Memory

## Taxonomy (verified 2026-03-04)
- v2.0.0: 1,542 tags across 6 verticals (food-cooking, home-garden, parenting-family, entertainment, automotive, history-biography)
- Flat structure with synonym mappings. history-biography added in v2 to fix hallucination gap.
- Source file: `/Users/matthewrance/Documents/Sibyl/data/taxonomy/taxonomy-v1.json`

## Analogies That Work
- SQS queue = restaurant ticket rail (orders queued so kitchen works at steady pace)
- Confidence routing = quality-control inspector on a production line
- DLQ = returns bin for failed items
- Serverless = on-demand staffing (spin up when busy, shut down when idle)
- Three-layer prompt = "briefing pack for freelance reviewers" (Company Standards Card / Content-Type Brief / Assignment Envelope). More effective than "modular instruction manual" for line-manager audience -- the freelance reviewer frame maps directly to how editorial teams already think about outsourced classification work.
- Gemini multimodal = "genuinely analyses what is happening visually across frames, not just reading a transcript or looking at a thumbnail" -- this distinction lands well because non-technical audiences often assume video AI = audio transcription
- Cross-region inference = "if one data centre is busy, the request goes to another" -- no need to explain inference profiles, just the reliability benefit

## Key Docs
- Executive summary: `/Users/matthewrance/Documents/Sibyl/docs/executive-summary.md`
- PRD: `/Users/matthewrance/Documents/Sibyl/docs/PRD.md`
- Walkthrough doc: `/Users/matthewrance/Documents/Sibyl/poc/docs/poc-walkthrough-for-line-manager.md`
- Technical stack overview: `/Users/matthewrance/Documents/Sibyl/poc/docs/technical-stack-overview.md` (engineer onboarding, full stack walkthrough)

## Audience Notes
- Line manager briefing format: problem > solution > how it works > UI demo > validation > next steps
- Lead with business problem, not technology
- 10-15 min constraint means ~10 sections max, each 1-2 min
- When expanding technical detail for line managers, anchor each sub-concept in "why it matters to the business" before explaining mechanism
- Prompt architecture resonates when framed as "text edits not code deployments" -- this maps to speed of iteration, which managers care about
- Two-provider vs one-provider discussion lands best framed as operational simplicity trade-off, not a technical debate

## Prompt Architecture Details (verified against source 2026-03-04)
- Layer 1 (system): role, JSON output format, taxonomy constraints, confidence scoring guide, 3-10 tag limit
- Layer 2 (content-type): articles=8 dimensions, podcasts=10 dimensions (most aggressive), video=visual focus, JSON=structured data focus
- Layer 3 (runtime): taxonomy text + title + body (truncated at 32,000 chars ~8k tokens) + maxTags
- Layer 1 goes into Claude `system` field; Layers 2+3 combined into user message
- Source: `/Users/matthewrance/Documents/Sibyl/poc/src/lambdas/text-processor/prompts.ts`

## AI Service Details (verified 2026-03-04)
- Bedrock model: cross-region inference profile (us.anthropic.claude-sonnet-4-20250514-v1:0), routes across US East-1, East-2, West-2
- Gemini model: gemini-2.5-flash (not 1.5 Flash as earlier docs state -- code uses 2.5)
- Gemini flow: upload to File API > poll ACTIVE > generateContent > delete file
- IAM: cross-region profile ARN + foundation model ARNs in all 3 regions required

## CDK Verified Values (verified 2026-03-05 against content-tagging-stack.ts)
- Text Lambda: Node.js 20.x, 512MB, 30s timeout, batch size 10 (5s window)
- Video Lambda: Node.js 20.x, 3008MB (3GB), 300s timeout, batch size 1
- Shared DLQ: single DLQ for both text+video, 14-day retention
- Text queue visibility: 180s. Video queue visibility: 1800s.
- Note: some earlier docs/specs say Node 22, text batch=1, video mem=1024 -- code says otherwise
