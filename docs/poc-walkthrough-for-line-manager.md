# Sibyl PoC -- System Walkthrough

**Audience:** Line manager (first introduction to the project)
**Format:** 10-15 minute verbal walkthrough with this document as a reference
**Date:** 5 March 2026

---

## TL;DR

We have built a working proof of concept that uses AI to automatically tag media content -- articles, podcast transcripts, archived print records, and videos -- with standardised labels from a controlled list of 1,542 tags. The system decides how confident it is in each tag: high-confidence tags are published automatically, while uncertain ones are routed to a human editor for review. Everything is deployed and running on AWS, with a web-based interface for submitting content, reviewing AI suggestions, and exploring tagged results.

---

## 1. The Problem We Are Solving

Today, content tagging across the business is manual, inconsistent, and siloed. The same topic might be tagged "baking" by one editor, "Baking" by another, and "baked goods" by a third. Multiply this across 775,000+ pieces of content spanning articles, videos, podcasts, and print archives, and the result is:

- **We cannot answer basic questions** like "How much content do we have about sourdough?" across all formats.
- **Advertising teams cannot package content reliably** by topic, because the labels are inconsistent.
- **Cross-content analytics are impossible** when every team uses different vocabulary.

---

## 2. What Sibyl Does

Sibyl is an AI-powered tagging system that reads (or watches) a piece of content and applies tags from a single, approved vocabulary of **1,542 standardised tags** organised across six editorial verticals:

| Vertical | Example Tags |
|----------|-------------|
| Food and Cooking | sourdough, meal-prep, air-fryer, gut-health |
| Home and Garden | indoor-plants, renovation, paint-colours |
| Parenting and Family | toddler-milestones, school-readiness |
| Entertainment | streaming-reviews, celebrity-interviews |
| Automotive | electric-vehicles, used-car-buying |
| History and Biography | victorian-era, royal-history |

The AI is only allowed to use tags from this approved list -- it cannot invent its own. This is what makes the output consistent and useful for analytics.

---

## 3. How It Works (The Non-Technical Version)

Think of the system as a production line with three stages: **intake**, **processing**, and **quality control**.

### Stage 1: Intake -- Content Enters the Queue

When someone submits content (via the web interface, or eventually via automated feeds from WordPress and other sources), the item is placed into a **waiting queue** rather than being processed immediately.

**Why a queue?** Imagine a restaurant kitchen. Orders come in at unpredictable rates -- sometimes one at a time, sometimes a rush of fifty. The queue is like the ticket rail above the pass: it holds orders in line so the kitchen can work at a steady pace without dropping anything, and nothing is lost even if the kitchen is momentarily busy.

There are two separate queues: one for text content (articles, podcast transcripts, JSON archives) and one for video. Video has its own queue because it takes significantly longer to process -- roughly 30 minutes per item compared to seconds for text.

### Stage 2: Processing -- AI Reads the Content and Suggests Tags

When an item reaches the front of the queue, a small, dedicated processing unit picks it up and sends it to an AI service.

- **For text content** (articles, podcasts, archives): the content goes to **Claude**, an AI model from Anthropic, accessed through a managed AWS service called Bedrock. Claude reads the text, understands the topics and themes, and returns a set of tags -- each with a confidence percentage indicating how sure the AI is about that tag.

- **For video content**: the video file goes to **Google Gemini**, an AI that can natively understand video -- it analyses what is shown across frames over time (objects, scenes, actions, on-screen text) and returns tags in the same format.

The AI does not just receive the content. It also receives structured instructions (a "prompt") that tell it: here is the approved tag list, here is the type of content you are looking at, here are the rules for how to tag it. This prompt has three layers -- shared rules, content-type-specific guidance, and the actual tag list -- which means we can adjust tagging behaviour without changing any code.

### Stage 3: Quality Control -- Confidence Routing

Every tag the AI returns includes a confidence score. The system then makes an automatic decision:

- **85% confidence or above**: The tag is **auto-published**. The AI is confident enough that no human check is needed.
- **Below 85% confidence**: The item is routed to a **human review queue**, where an editor can accept, reject, or modify the suggested tags.

This is similar to a quality-control inspector on a production line. Items the inspector is confident about pass straight through; items they are unsure about get pulled aside for a second pair of eyes.

Any tag below 50% confidence is discarded entirely -- the AI is effectively saying "I am guessing" and those guesses are not worth showing.

---

## 3b. How the AI Knows What to Look For

The AI does not simply receive a piece of content and wing it. Every time an item is processed, the AI receives a carefully structured set of instructions -- a "prompt" -- that tells it exactly what to do, what vocabulary to use, and what format to return results in.

These instructions are built from **three separate layers**, and understanding why they are separate is important for understanding how the system stays accurate, consistent, and easy to improve.

### The Briefing Pack Analogy

Imagine you are briefing a team of freelance reviewers to classify content for the business. You would not write a single, monolithic document that mixes general company standards with content-specific guidance and today's particular assignment. Instead, you would give each reviewer a briefing pack with three distinct parts:

1. **The Company Standards Card** -- the rules that apply to every reviewer on every assignment. Use only approved vocabulary. Return your assessment in the standard report format. Follow the confidence scoring guide. This card never changes.

2. **The Content-Type Brief** -- specific guidance for the type of content they are reviewing today. If they are reviewing a podcast, you would tell them: "Podcasts shift topic mid-episode, so scan each segment separately -- do not anchor on the dominant theme." If they are reviewing an article, you would tell them to look for recommendation signals, referenced works, and reader intent. Each content type has its own brief.

3. **The Assignment Envelope** -- the actual work for this particular item: here is the content itself (title and body text), here is the complete approved vocabulary list, and here is the maximum number of tags to return. This changes with every single item.

That is exactly how Sibyl's prompt works.

### What Each Layer Contains

**Layer 1 -- Shared Rules (the "Company Standards Card")**

This layer tells the AI: you are an expert content tagging system. It sets the rules that never vary:
- Only use tags from the approved taxonomy -- never invent new ones
- Return results as structured data (not free text), so the system can process them automatically
- Apply 3 to 10 tags per item, prioritising quality over quantity
- Score each tag's confidence on a defined scale (90-100% means the tag is central to the content; 70-89% means relevant but not the main focus; 50-69% means mentioned or tangential; below 50% means do not include it)

This layer is identical for every single piece of content the system has ever processed. It is the foundation.

**Layer 2 -- Content-Type Instructions (the "Content-Type Brief")**

This is where the system gets noticeably smarter than a one-size-fits-all approach. Different content types need different analysis strategies:

- **Articles** are scanned across eight dimensions: main topics, content format (is it a review, an interview, a profile?), referenced works, tangential subjects, tone and recommendation signals, specific techniques mentioned, featured products, and reader intent.

- **Podcasts** get the most aggressive instructions -- ten scanning dimensions -- because they are the hardest content type to tag well. A 45-minute podcast episode might cover five different topics across its segments, feature a guest whose expertise spans multiple areas, and include anecdotes that cross editorial verticals entirely. The instructions explicitly tell the AI: "Do not anchor on the dominant theme. Treat each segment as a separate tagging opportunity."

- **Videos** focus on what is visually depicted: subjects, demonstrations, products, and locations prominently shown on screen.

- **Archived JSON records** focus on structured data fields, classification signals, and key descriptors already present in the record.

When we want to improve how podcasts are tagged, we only edit the podcast brief. The shared rules, the article instructions, and everything else remains untouched. This is what modularity means in practice.

**Layer 3 -- Runtime Context (the "Assignment Envelope")**

This is the only layer that changes with every single request. It contains:
- The complete taxonomy -- all 1,542 approved tags, formatted as a reference list
- The actual content to be tagged: title and body text
- The maximum number of tags for this request

Content is truncated at 32,000 characters (roughly 8,000 words) before being sent to the AI. This is a deliberate cost control measure -- sending a 50,000-word archive would cost significantly more in AI processing fees without meaningfully improving tag accuracy, because the AI has typically identified the key themes well before that point.

### Why Three Layers Matters

This design has four practical benefits:

1. **Improving tagging does not require a code change.** If we discover that podcasts are being under-tagged for cross-vertical themes, we edit Layer 2's podcast instructions -- a text edit, not a software deployment. This means prompt tuning can happen quickly and frequently.

2. **Taxonomy updates flow through automatically.** The tag list is injected at Layer 3, at the moment each item is processed. If the taxonomy team adds 50 new tags tomorrow, every subsequent item will be tagged against the updated vocabulary with no code change and no redeployment.

3. **Consistency is structural, not accidental.** Because Layer 1 is identical for every request, the output format, confidence scoring, and core constraints never drift. Every item is held to the same standard.

4. **Each layer can be owned and improved independently.** The taxonomy team manages the tag list. The prompt team optimises the content-type instructions. The platform team manages the shared rules. No one steps on anyone else's work.

### The Two AI Services: Claude and Gemini

Sibyl uses two different AI services, each chosen for a specific strength.

**Claude (via AWS Bedrock) -- for all text content**

Claude is an AI model made by Anthropic (the same company behind this tool). We access it through **AWS Bedrock**, which is Amazon's managed AI service. This means we do not host, maintain, or scale the AI ourselves -- we make an API call to AWS, and Bedrock handles the rest.

What Claude does well for us:
- **Deep text comprehension** -- it understands nuance, context, tangential references, and recommendation signals in written content. When an article casually mentions a novel in the third paragraph, Claude picks up on it.
- **Reliable structured output** -- it consistently returns well-formed data (tags with confidence scores) rather than free-text responses, which means downstream systems can process results automatically.
- **AWS-native** -- it runs inside our existing AWS account. Billing is consolidated, data does not leave the AWS ecosystem, and it integrates naturally with the rest of our infrastructure.

We use a "cross-region" configuration, which means AWS automatically routes each request to whichever US data centre currently has capacity. If one data centre is busy, the request goes to another. This improves reliability without any manual intervention.

**Google Gemini -- for video content only**

Gemini is Google's AI, and its key differentiator is that it is **multimodal** -- it natively understands video, not just text. When we send a video to Gemini, it genuinely analyses what is happening visually across the frames over time: objects, scenes, actions, on-screen text. It is not simply reading a transcript or looking at a thumbnail.

The video processing flow is more involved than text:
1. The video file is downloaded from our secure storage
2. It is uploaded to Gemini's temporary processing service
3. The system waits for Gemini to confirm the file is ready
4. The tagging prompt is sent along with the video reference
5. Gemini analyses the video and returns tags
6. The video file is deleted from Gemini's temporary storage

That last step -- deletion -- is deliberate. Video files never sit permanently in Google's storage. This is both a cost control measure (Google charges for stored files) and a data handling discipline.

**Why two providers, and will it stay that way?**

At the time we built the PoC, Gemini had the strongest proven capability for native video understanding. Claude excels at text but did not yet offer comparable video analysis through Bedrock.

Since then, Claude's visual capabilities have improved significantly and are now available through AWS Bedrock. We are actively evaluating whether Claude Vision could replace Gemini for video tagging. If it can, the production system would use a single AI provider for everything -- which meaningfully reduces operational complexity, billing consolidation, security surface area, and the number of vendor relationships to manage.

For the PoC, using two providers was the right pragmatic choice: proven capability for each content type, reasonable cost, and fast to integrate. The production decision will be informed by side-by-side accuracy and cost comparisons that the PoC infrastructure now makes possible.

---

## 4. What Happens When Something Goes Wrong

Reliability was designed in from day one, not bolted on afterwards.

- **Automatic retries**: If a processing attempt fails (for example, the AI service is temporarily unavailable), the system automatically retries up to three times, with increasing wait times between attempts. This handles transient issues without any human intervention.

- **Dead letter queue**: If an item still fails after three attempts, it is moved to a separate "failed items" queue (called a dead letter queue). Think of it as a returns bin -- nothing is lost, and an engineer can investigate and reprocess the items later. This prevents one bad item from blocking the rest of the queue.

- **No servers to manage**: The processing units are "serverless" -- AWS creates them on demand when there is work to do, and shuts them down when there is not. This means there is no server that can crash overnight and block everything. It also means we only pay for actual usage, not idle capacity.

---

## 5. What You Can See in the UI

The web interface has four main areas:

### Submit Page
Where content enters the system. You can paste article text directly, or upload a video file. The system detects the content type and routes it to the appropriate queue.

For video uploads, the file goes directly to secure cloud storage (S3) via a temporary upload link -- the video never passes through the web server itself, which keeps things fast and avoids size limitations.

### Review Queue
This is the human quality-control station. It shows all items where the AI's confidence fell below 85%. An editor can see the suggested tags, the confidence scores, and the original content, then approve, reject, or adjust the tags. This is how we maintain accuracy without requiring a human to review every single item.

### Content Explorer
A browsable catalogue of all tagged content. You can filter by tag, by content type (article, video, podcast, archive), or both. Click on any item to see its full tag set and -- importantly -- **related content**. The system calculates which other items share the most tags in common (using a mathematical similarity score) and surfaces them. This is a preview of the cross-content discovery that becomes possible once everything is tagged consistently.

### Taxonomy Explorer
A reference view of the full 1,542-tag taxonomy, organised by vertical and category. This lets editors and stakeholders browse the available vocabulary and understand how it is structured.

---

## 6. What the PoC Has Validated

This proof of concept was designed to answer specific questions before committing to a full production build. Here is what it demonstrates:

| Question | What the PoC Proves |
|----------|---------------------|
| Can the end-to-end architecture work? | Yes -- content flows from submission through queuing, AI processing, confidence routing, storage, and display without manual intervention. |
| Can AI tag content accurately enough? | The system produces tags with confidence scores and routes uncertain items for human review. Accuracy is measurable against a 100-item test set with pre-defined expected tags. |
| Can we handle video as well as text? | Yes -- video uses a separate AI (Gemini) with a dedicated queue and longer processing allowance, but produces tags in the same format and enters the same review/explore workflow. |
| Is human review practical? | The review queue UI shows editors exactly what they need to make fast decisions -- suggested tags, confidence levels, and the original content side by side. |
| Can we discover related content across formats? | The Content Explorer's similarity scoring shows that consistent tagging enables cross-format content discovery (e.g., an article about sourdough is linked to a video about bread baking). |
| What does it cost? | A cost-tracking table records the AI model used, tokens consumed, processing cost in USD, and latency for every single item. This gives us real data to project production costs. |

---

## 7. What This Does NOT Include (Yet)

To keep the PoC focused, several production concerns are deferred:

- **Live content feeds**: The PoC uses manual uploads. Production will connect to WordPress (articles), YouTube (videos), and existing archive systems via automated feeds.
- **Azure data warehouse sync**: Tagged data stays in AWS for now. Production will sync results to the Azure data warehouse for analytics and reporting.
- **Production security hardening**: The PoC runs on an isolated AWS account. Production deployment will include access controls, security review, and monitoring.
- **Scale testing**: The PoC demonstrates the architecture works. Load testing at 775,000-item scale is a Phase 4 activity.

---

## 8. Key Architecture Decisions and Why They Were Made

| Decision | Why |
|----------|-----|
| **Queue-based (asynchronous) processing** | Content can be submitted at any rate without overwhelming the system. Processing happens at a steady, manageable pace. Nothing is lost if the system is busy. |
| **Separate queues for text and video** | Video takes 30 minutes to process vs. seconds for text. Mixing them in one queue would mean text items wait behind slow video jobs. Separate queues let each move at its natural pace. |
| **Serverless compute (Lambda)** | No servers to maintain or monitor. Scales automatically from zero to hundreds of concurrent processors. We only pay for actual processing time, not idle capacity. |
| **Two AI providers (Claude for text, Gemini for video)** | Each AI was chosen for a specific strength: Claude (accessed through AWS Bedrock) provides best-in-class text comprehension and runs natively within our AWS infrastructure. Gemini (Google) provides native video understanding -- it genuinely analyses visual content across frames, not just transcripts. For production, we are evaluating whether Claude Vision (now available through AWS Bedrock) could handle video too, which would consolidate to a single provider and reduce operational complexity, billing, and security surface area. The PoC infrastructure enables direct accuracy and cost comparisons to inform this decision. |
| **85% confidence threshold** | Balances automation with accuracy. Items the AI is confident about flow through automatically; uncertain items get human review. The threshold is adjustable -- if we find the AI is more (or less) accurate than expected, we can tune it. |
| **Three-layer prompt architecture** | The AI's instructions are built from three independent layers: (1) shared rules that enforce consistent output format and confidence scoring across every request, (2) content-type-specific instructions that tailor the analysis strategy to articles, podcasts, videos, or archives -- for example, podcasts get ten scanning dimensions because they shift topic mid-episode, while articles get eight -- and (3) runtime context containing the actual taxonomy and content. This separation means prompt improvements are text edits rather than code deployments, taxonomy updates flow through automatically, and each layer can be owned and improved by a different team without conflicts. See Section 3b for the full explanation. |
| **Cost tracking built in from day one** | Every processing job records its cost. This lets us project operational spend accurately before committing to full-scale production. |

---

## 9. Numbers at a Glance

| Metric | Value |
|--------|-------|
| Total content to be tagged (production) | 775,000+ items |
| Standardised tags in taxonomy | 1,542 across 6 verticals |
| Confidence threshold for auto-publish | 85% |
| Text processing time per item | Seconds |
| Video processing time per item | Up to 30 minutes |
| Retry attempts before failure routing | 3 |
| PoC test set size | 100 items (stratified across content types) |

---

## 10. What Comes Next

If the PoC results are positive, the path to production is:

1. **Phase 1 (3 weeks)**: Deploy the same code to the company AWS account with production-grade security and monitoring.
2. **Phase 2 (6-8 weeks)**: Connect live content sources (WordPress, YouTube, archives) and the Azure data warehouse. This is the phase that requires cross-team coordination.
3. **Phases 3-5 (13-17 weeks)**: Prompt tuning with real content, load testing, and phased rollout -- starting with new content only, then backfilling 10%, then full backfill of all 775,000+ items.

The PoC code and architecture carry forward into production. Subsequent phases are about deployment, integration, and scale -- not rebuilding.

---

**Prepared for line manager briefing, 5 March 2026.**
