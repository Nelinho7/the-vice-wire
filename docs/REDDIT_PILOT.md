# First authorized Reddit pilot

This extends the existing V0 pipeline. No live Reddit or LLM call has been made in the delivered environment. Default dashboard and fixture tests keep working. A synthetic/mock test is never labeled a live pilot.

## Configuration and access

Copy `.env.example` to `.env` in the project folder. Do not paste keys into the dashboard or commit them. The source requires explicit Reddit approval for this intended use, a valid approved OAuth bearer token with **read** scope, and an identifying User-Agent. Auth checks read each configured community; no user profile/account endpoint is needed. Downstream LLM processing and local retention must be permitted for this use. See [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki), [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/16471395473812-Moderation-Bots-Tooling), [Data API terms](https://redditinc.com/policies/data-api-terms), and [official endpoint documentation](https://www.reddit.com/dev/api/).

Required Reddit values:

```dotenv
REDDIT_ACCESS_APPROVED=true
REDDIT_ACCESS_TOKEN=<approved OAuth bearer token>
REDDIT_USER_AGENT=<registered application identifier, version and contact>
```

Required for live intelligence processing:

```dotenv
LLM_ENDPOINT=<HTTPS structured chat-completions endpoint>
LLM_API_KEY=<provider key>
LLM_MODEL=<model supporting strict JSON schema and max_tokens>
LLM_INPUT_PRICE_PER_MILLION=<current model input price>
LLM_OUTPUT_PRICE_PER_MILLION=<current model output price>
```

Keep `SOURCE_MODE=fixture` and `EXTRACTOR_MODE=fixture` for the existing dashboard's fixture ingestion. **Pilot commands always use the real Reddit adapter and real structured LLM provider**, regardless of these fixture-mode settings. Never set EXTRACTOR_MODE=fixture and call results live. Direct `ingest`/`worker` Reddit mode is disabled so it cannot bypass the staged pilot or budget controls. The dashboard's fixture ingestion button cannot launch a live batch. Live commands print an actionable error and exit 1 before requesting a missing API.

`config/reddit-pilot.json` supplies communities and topic queries. Default communities: gtaonline, GTAV, GTA. Add GTA6 later by changing this file or `REDDIT_SUBREDDITS`; no application rewrite is needed. `REDDIT_PILOT_CONFIG` selects a project-relative configuration file. Re-run auth when communities/access changes.

## Isolation and persistent limits

The fixture database remains `data/vice-wire.sqlite`. The pilot uses `PILOT_DB_PATH=data/reddit-pilot.sqlite`, `PILOT_ID=reddit-v0`. The existing dashboard reads both with explicit real/fixture/source/subreddit filters. Pilot reports and budget ledgers select only Reddit sources for the current pilot ID. Fixture labels do not enter pilot metrics. For a second independent benchmark run, choose a new database as well as a new pilot ID; platform/source IDs are stable and cannot be duplicated across runs in one database.

Conservative defaults:

| Setting | Default |
|---|---:|
| PILOT_MAX_SOURCE_ITEMS | 50 |
| PILOT_MAX_LLM_CALLS | 50 |
| PILOT_MAX_ESTIMATED_SPEND | 2 (USD or provider pricing currency, consistently configured) |
| LLM_MAX_OUTPUT_TOKENS | 1500 |
| LLM_MAX_INPUT_BYTES | 48000 |
| REDDIT_MAX_API_REQUESTS | 100 per collection/auth invocation |
| REDDIT_REQUEST_DELAY_MS | 2000 |
| REDDIT_LISTING_LIMIT | 10 |
| REDDIT_COMMENTS_PER_POST | up to 5, lower for small samples |
| REDDIT_MAX_PAGES_PER_LANE | 2 |

Source/call/spend limits are cumulative for this pilot, not reset each command. New source counts are checked again inside the storage transaction. Before each paid extraction, a SQLite transaction checks the ledger and reserves a maximum estimated cost. Reservations use serialized request UTF-8 bytes + 512 overhead as a conservative input-token allowance, plus the configured maximum output tokens, priced with your supplied rates. Oversized input is retained and rejected, not silently truncated. The request sends `max_tokens`; verify your provider honors it and its tokenizer is bounded by the estimate. This is an **estimated** cap, not a guarantee about a provider's invoice or hidden fees.

Pending, interrupted, failed or unpriced calls retain their reservation and block further calls. If a provider reports costs exceeding a reservation, further calls stop. A normal limit stop logs LIMIT and leaves unprocessed items intact; it does not pretend they were rejected or extracted. Completed call costs replace reservations. Free-text or schema-invalid output never enters claims but still records the call and cost. One unresolved call cannot silently become zero-cost.

There is deliberately no automatic ledger override UI: reconcile unknown costs with the provider and correct the local usage record under engineering review before more paid processing. Do not reset a pilot merely to bypass a budget. `PILOT_OTHER_COST` is a cumulative non-LLM cost (Reddit/API/manual import charges, if any); explicitly use 0 when free. Total pilot cost stays **null** when this cost or any LLM cost is unknown. Costs exclude staff time unless you enter it in the same currency.

Run one collection/processing CLI at a time. Cost reservations are atomic, but the prototype is not a distributed ingestion system. The dashboard supports evaluations while the worker is idle; refresh after CLI work. Retention/deletion obligations are manual in V0.

## Stages and exact commands

Run from this project folder. Windows uses `npm.cmd`; other systems use `npm`.

### 1. Authentication

```powershell
npm.cmd run pilot:auth
```

Tests OAuth reads for all configured communities. It saves success and request metadata, not credentials or profile data. Success is not a substitute for explicit Reddit approval. HTTP 401/403/429 abort without scraping, automatic alternate accounts or endpoint fallbacks.

### 2. Ten-item parsing/storage smoke

```powershell
npm.cmd run pilot:smoke
npm.cmd start
```

Open `http://127.0.0.1:3210`, choose Source=Reddit or Data=Real. Inspect original text, source URLs, post/comment type, parent/post context, timestamps and sampling state. Smoke collects **up to 10 posts/comments combined**, not ten posts plus unlimited replies. It does not spend LLM tokens. If the API returns fewer items or stops, inspect `pilot:report`; do not approve an incomplete smoke.

If LLM credentials/prices are configured, process those ten through the unchanged intelligence stages:

```powershell
npm.cmd run pilot:process
npm.cmd run pilot:report
```

Then record the human parsing inspection:

```powershell
npm.cmd run pilot:approve -- smoke --note "Checked the 10 items, Reddit URLs, timestamps and conversation context"
```

This is an explicit stored review gate, not an automatic success claim. It requires ten stored items and no last sampling error.

### 3. Fifty-item intelligence test

```powershell
npm.cmd run pilot:intelligence
```

Checks LLM credentials/prices before collecting, brings the dataset to **50 total**, and processes eligible unprocessed items through the existing pipeline. It reuses previous smoke data and skips completed sources. An API/parser error retains the partial sources and stops before automatic processing. A processing/schema/provider error stops the live batch and remains in audits. A budget stop preserves pending work.

Review at least 10 sources in the dashboard, including surfaced intel **and rejected items**. Label extraction and matching, usefulness 1–5, and “Would I show this to a GTA player?” YES/NO. Review every ambiguity and suspected incorrect merge. Use a random/stratified source sample, not only high-confidence claims. If fewer than 50 are collected, re-run this command after resolving permitted access/rate issues.

```powershell
npm.cmd run pilot:report -- --output data/pilot-50-report.json
npm.cmd run pilot:approve -- intelligence --note "Inspected all errors/matches and reviewed a mixed sample of at least 10 items"
```

Approval requires 50 processed items, at least 10 human evaluations, no unresolved source errors, and no last sampling error. Fix errors and explicitly reprocess them before approval. Ten labels are only a stage gate, not enough to prove feed usefulness.

### 4. Two-hundred to five-hundred-item pilot

After reviewing the 50-item test, explicitly raise the `.env` limits to your agreed cap, for example:

```dotenv
PILOT_MAX_SOURCE_ITEMS=500
PILOT_MAX_LLM_CALLS=400
PILOT_MAX_ESTIMATED_SPEND=5
```

```powershell
npm.cmd run pilot:ingest -- --items 200
npm.cmd run pilot:process
npm.cmd run pilot:report -- --output data/pilot-200-report.json
```

Repeat with `--items 500` only if the pilot needs a larger sample and budget/access allow it. Targets are **total raw SourceItems**, including useless controls; the report shows how many were actually useful. Reaching 200–500 useful candidates may require another permitted run if this raw sample contains fewer; do not exceed the 500-item cap automatically or claim it yielded 500 useful items. A deliberate mixture is more important than volume. Default 100 API requests may yield a partial large sample; subsequent capped invocations continue from a persisted sampling cursor and skip known IDs. Inspect stop reasons and wait for the provider's reset window after 429. This is bounded pilot sampling, not continuous broad surveillance.

### Reprocessing, evaluation, export and reset

```powershell
# Skip already completed items; process pending items within cumulative limits.
npm.cmd run pilot:process
# Explicitly retry errored items after inspecting/fixing the error.
npm.cmd run pilot:process -- --retry-errors
# JSON report, including the top 20 confidence-ranked claims.
npm.cmd run pilot:report -- --output data/reddit-pilot-report.json
# Load a JSON evaluation or array of evaluations, atomically.
npm.cmd run pilot:label -- --file docs/human-evaluation.example.json
# Authorized benchmark text and label history; keep local/private.
npm.cmd run pilot:export -- --output data/private-benchmark.json
# Reset only Reddit data for this pilot ID, after backing up required review data.
npm.cmd run pilot:reset -- --pilot-id reddit-v0
```

The example evaluation contains a placeholder source ID; replace it with a real stored ID before importing. Reset removes matching live sources, evidence, audits, usage, evaluations, now-orphaned claims and stage state. It preserves fixtures, fixture test files, and other pilot IDs. Shared remaining claims are rescored. It deletes pilot evaluation data too; export first if it is needed. This command is deliberately not called during validation of an existing user dataset.

## Sampling and conversation context

Round-robin lanes mix **new**, **hot**, **top of the past week**, and configured search queries over the past month, with rotating communities/queries. Search is discovery, never a usefulness label. Listings use authorized `after` pagination up to a configured page cap. Overlapping IDs are stored once. Up to five returned comments per thread are sampled (one per thread for the ten-item smoke); Reddit replies are traversed with their parent text. Removed/deleted comments are not turned into claims. IDs, post title/body, parent ID/text, subreddit, thread identity, text, author identifier, score, URL and publication/ingestion times are stored. Raw metadata is allowlisted; profiles, email, location and unrelated personal information are not collected.

Comments are bounded from the official conversation endpoint and currently sorted top. `more` nodes are counted but not expanded; this is **not exhaustive comment ingestion**, and lower-score comments can be underrepresented. Known sampled posts are skipped on later collections, so fresh replies/edits/deletions are not monitored automatically. Lane provenance and omissions appear in sampling receipts. API request delays, rate-limit headers, per-run caps and 429 stops are honored. Token refresh remains manual.

The provider gets conversation context but quotes and extracted evidence must come from the actual primary comment. Parent context is not counted as separate support. Confidence v0.2 counts support once per canonical Reddit thread, collapses repeated authors/text/crossposts, and keeps one same-thread contradiction as a conservative penalty. Many upvoted echoes cannot verify a claim. Numeric observations remain visible on each Evidence record. Unsupported speculation is rejected with its reason; inconclusive observations may enter as uncertain evidence.

## Human benchmark and metrics

Source evaluation records live in their own `evaluations` table, never overwrite claims or confidence, and keep all revisions/reviewer aliases. The report uses the latest evaluation per source. Fields: YES/NO/UNCERTAIN useful intel; category; extraction correct/partially correct/incorrect; one of the four requested matching labels; usefulness 1–5; notes; feed decision YES/NO. YES requires quality fields. NO/UNCERTAIN require a NO feed decision. A source's claimed usefulness can be associated with its linked claim IDs; a multi-claim source rating is a projection, not independent human review of every claim.

Reports include posts/comments, classified/rejected/unprocessed sources, human labels, TP/FP/FN/TN, useful precision/recall, extraction and matching judgments, incorrect merges, contradictions, claims/statuses, average usefulness, **feed YES share and unique reviewed claim IDs approved for the feed**, errors/limit stops, calls/tokens, known/unknown costs, sampling coverage and detection/processing latency. Unprocessed sources and uncertain labels are excluded from the confusion matrix and reported as unmeasurable. Unlabeled items are never treated as correct or incorrect. Retried errors remain in historical event counts; stage gates use unresolved errors.

The top 20 includes claim/category/confidence/status, supporting source count **and independent supporting count**, contradictions, first detection/creation/last corroboration and human usefulness ratings when available. Null means not measured. Dedup correctness is the requested source-review judgment, not pairwise precision/recall. The report does not claim that good extraction implies player value. Feed YES and in-game validation matter.

Publication-to-first-ingestion latency includes the age of intentionally sampled hot/top/search content. Claims additionally record actual creation time, source processing start/end and duration. Evaluate new-lane timeliness separately before extrapolating to a live GTA VI feed.

Use `V0_EVALUATION_PLAN.md` for the 48–72 hour experiment and go/no-go criteria. Maintain a mixed source sample, report label counts and uncertainty, and inspect actual in-game usefulness. A zero-item/zero-label report explicitly reads **NOT VALIDATED**.
