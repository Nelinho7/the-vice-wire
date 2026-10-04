# The Vice Wire

The Vice Wire is a **GTA community intelligence research prototype**. It identifies potentially useful gameplay information, structures it into claims, and keeps original source evidence separate. It detects corroborating, contradictory, and uncertain reports and applies deterministic confidence scoring whose components are visible for review.

The prototype is currently being tested using **GTA V / GTA Online before GTA VI launches**. Included examples and regression fixtures are synthetic; they are not collected Reddit content or proof of gameplay accuracy. Live usefulness remains subject to authorized pilot testing and human review.

## Authorized sources and Reddit API application

The intended ingestion model uses permitted public community information through authorized APIs. **Reddit will be one authorized source alongside other future permitted sources**; the current implementation includes synthetic fixtures and a guarded Reddit adapter. Live Reddit access requires explicit approval for the intended use, an approved OAuth token, and an identifying User-Agent. Any downstream model processing and retention must also be permitted.

The project does not bypass authentication, rate limits, access controls, or Reddit API restrictions. It does not vote, post, message Reddit users, or access private Reddit content. The current Reddit workflow performs read-only requests to configured public community listings and comment endpoints through `oauth.reddit.com`. It has no scraping fallback or automatic account switching.

The Reddit pilot is deliberately limited: a 10-item parsing stage precedes a 50-item intelligence stage, with explicit human review gates. Defaults cap stored source items at 50, model calls at 50, estimated model spending at 2 in the configured pricing currency, and API requests at 100 per invocation. Requests are spaced by at least the configured delay (2 seconds by default); rate headers and HTTP 429 stop or defer collection. Persistent cost reservations block further processing when spending is unresolved. Larger samples require deliberate configuration and stage approval. See [the pilot guide](docs/REDDIT_PILOT.md) for limits and assumptions.

**The Vice Wire is not affiliated with Rockstar Games, Take-Two, or Reddit.**

## Security and privacy

This repository publishes source code, synthetic test fixtures, placeholder configuration, and documentation. Credentials, `.env` variants, local SQLite databases and sidecars, collected community text, pilot exports, generated reports, reviewer records, logs, and local screenshots are excluded. `.env.example` contains blank credential fields and safe example settings only. Never put real credentials or personal information into it.

Permitted live source text, URLs, author identifiers, timestamps, and review notes stay in local databases; they are not part of this public source repository. Author identifiers are used for evidence independence, not user profiling. Retention and source deletion obligations are manual in V0; establish compliant handling before live collection. The local dashboard binds to loopback and is not a hosted public application.

## Run

Requires Node **24+**. No npm dependencies or installation needed. Native TypeScript stripping executes `.ts` files; Node's SQLite API is used for persistence. SQLite may emit an experimental API warning on some Node versions.

From this folder:

```powershell
npm.cmd test
npm.cmd run evaluate
npm.cmd start
```

Open `http://127.0.0.1:3210`. On macOS/Linux use `npm` instead of `npm.cmd`. The first fixture-mode dashboard start seeds a new database. `npm run ingest` imports a fixture batch; `npm run worker` polls fixture mode at the configured interval. The dashboard's Run fixture ingestion button imports another fixture batch. Successful source IDs are skipped on repeated runs. Failed items remain retryable. Refresh recomputes confidence recency. Restart with Ctrl+C as needed. No credentials are required for the default mode. Live Reddit uses the staged, guarded pilot commands below.

Optional configuration: copy `.env.example` to `.env`; edit values there. Never commit `.env` or databases. To reset the demo, stop the app and move the `data/` folder aside. Evaluation always uses a separate in-memory database and fixed clock; it never touches dashboard data. Review decisions are stored locally in the database.

## Architecture

- `src/model.ts`: platform-neutral SourceItem, IntelClaim (`Claim`), Evidence, Usage and Review records; structured extraction wire schema and runtime validation.
- `src/adapters.ts`: `SourceAdapter.fetchItems()` for fixture and approved Reddit API ingestion.
- `src/providers.ts`: interchangeable `ExtractionProvider`; labeled fixture replay and an HTTPS structured chat-completions provider.
- `src/intelligence.ts`: independently callable deterministic filter, normalization, matching and confidence functions.
- `src/pipeline.ts`: stages, transactional claim/evidence storage, audit trail, review and reassignment.
- `src/store.ts`: `Repository` implementation using SQLite. Separate source/claim/evidence tables, foreign keys, audit/usage/review tables, schema version and transactions.
- `src/server.ts`, `public/`: loopback-only HTTP dashboard and JSON routes. Plain browser JavaScript; no frontend build system.
- `src/evaluation.ts`, `tests/`: fixture evaluation and Node test runner.
- `src/reddit.ts`, `src/pilot-config.ts`: approved Reddit API client, configured sampling, posts/comments with conversation context.
- `src/pilot.ts`, `src/pilot-cli.ts`, `src/pilot-budget.ts`: staged pilot workflow, separate pilot database and atomic cost reservations.
- `src/human-evaluation.ts`, `src/pilot-report.ts`: separate, revisioned source labels and real-pilot metrics/top 20 claims.

The small server and ingestion worker share domain code but run as separate commands. A Postgres/Supabase implementation can replace `Repository`; for an asynchronous database, evolve the repository methods to promises and the transaction callback accordingly. V0 payloads are JSON with relational evidence links. A migration should materialize indexed columns and map these types to SQL/JSONB. No queue infrastructure is necessary at this scale. Avoid simultaneously running multiple ingest writers: V0 supports one ingestion process, not distributed job claims.

## Pipeline and audit

INGEST → FILTER → EXTRACT → NORMALIZE → MATCH → ATTACH EVIDENCE → SCORE CONFIDENCE → STORE.

Ingest preserves the original source text, URL, author, timestamps, engagement and raw metadata separately from claims. Filtering logs its decision even for discarded chatter. The cheap filter is deliberately conservative but currently heuristic; LLM `NO_INTEL` is a second gate. No extraction call is made for deterministic rejects.

The provider returns structured candidates or NO_INTEL. Runtime validation rejects malformed envelopes, unknown candidate fields, invalid stances, non-finite numerical values, missing entities, and quotes absent from the supplied text. All claims pass validation before database entry. External source text is explicitly treated as untrusted data in the extraction prompt. Provider refusals, invalid output and API failures produce error audits. Claim/evidence changes for one source are committed together; partial candidate writes roll back. Completed source IDs are idempotent. Audit and usage logs survive extraction/transaction errors.

Normalization canonicalizes entities and condition values with an extensible alias dictionary. Categories are open strings with a starter catalog, so a new category does not require a schema migration. Predicate, category, entities and conditions identify a proposition; monetary values are evidence observations, not identity. A GTA$900k disagreement therefore stays evidence on the same payout proposition rather than creating a new claim just because the number differs.

Matching uses entity Jaccard overlap (50%), predicate similarity (35%), and claim-text token overlap (15%). Conflicting known conditions exclude a match. Automatic merge needs score ≥0.85, identical canonical entities/predicate and complete equality of known conditions. Exact compatible matches take precedence over incomplete reports. Scores ≥0.65 that do not pass all merge gates create a separate needs-review claim with alternatives and reasons. Ties between complete matches also require review. V0 has no embeddings. Matching is isolated for later embeddings or model assistance.

Evidence stores support/contradiction/uncertainty, the extracted observation, verbatim quote and match decision. First detected means first source ingestion time; live claims additionally record their actual creation time. Sources record processing start/end/duration and publication-to-detection latency. Last corroborated is the most recent independent supporting source publication time. A contradiction or uncertain report does not advance last corroborated. Claim values remain the initial normalized observation; disagreement is exposed in evidence and scoring instead of overwriting the claim with the newest number.

## Deterministic confidence v0.2

Score is capped at 95 and floored at 0. Dashboard exposes every component:

| Component | Rule |
|---|---|
| Base | 15 if there is independent supporting evidence, otherwise 0 |
| Independent support | 12 per independent supporting report, capped at 45 |
| Recency | 15 × mean exp(-age / 7 days) for independent supporting reports |
| Numerical agreement | 10 × fraction of matching numerical observations within 10% of initial value; default agreement 1 when nonnumeric |
| Engagement | Mean log10(1 + score) for supporting sources, capped at 3 |
| Contradiction | −20 per independent contradicting report |
| Uncertainty | −4 per independent uncertain report |
| Copies/repeated authors | −2 per excluded report, capped at −10 |

Independence collapses matching author keys, exact canonical source text, and explicit copiedFrom/crosspost references. Reddit supporting reports count at most once per canonical thread, even from different commenters. One same-thread contradiction is retained conservatively instead of being suppressed by the support cap. Unknown Reddit authors share a conservative unknown key. This is a heuristic, not proof of independent reporting. Fixture data explicitly labels one copied item. Unknown source reliability is neutral; no reliability boosts are invented.

- UNVERIFIED: fewer than 2 independent supporters.
- DEVELOPING: at least 2 independent supporters, but higher status gates unmet.
- LIKELY: at least 3 supporters, score ≥65, no independent contradictions.
- VERIFIED: at least 4 supporters, score ≥85, no independent contradictions, numerical agreement ≥90%.

One viral post cannot verify a claim. VERIFIED is the model's corroboration status, not a guarantee of factual truth. Reviews are recorded separately and never force an artificial confidence percentage. Invalid/duplicate reviewed claims are excluded as automatic merge targets. They stay visible and auditable. Marking duplicate is a label; moving evidence uses the explicit reassignment control. Reassignment rescales both affected claims and keeps its history. The UI requires a note; reviewer identity/authentication is outside local V0 scope.

## Dashboard

Category/status filters; sort by latest corroboration or a simple relevance proxy (confidence + 2 × evidence count). Clicking a claim reveals conditions, numbers, score breakdown, supporting/contradicting/uncertain evidence, original text and raw metadata, URLs, source/ingestion times, extraction payloads and match alternatives. Review controls mark valid, invalid, duplicate, needs review; each evidence item has a target selector for reassignment. Rejected sources and stage errors are available in the full source audit panel. Usage records show model, provider, stage, tokens and cost. Added pilot controls filter Reddit/platform, subreddit, real/fixture, and human evaluation state. Expand a source to label usefulness, extraction, matching, rating and whether a GTA player should see it. Pilot metrics/top 20 are shown separately from fixture counts.

Local security: loopback binding only, Host/origin validation and an in-process anti-CSRF token on mutations; browser text uses textContent rather than untrusted HTML. No outbound messages, browser-exposed credentials or unauthenticated remote binding. Local data may include public authors: restrict who can access the machine. This is not a production service.

## Fixture mode and evaluation

`src/fixtures.ts` has **25 synthetic, labeled** items: 17 useful observations, 8 chatter/speculation/questions, overlapping entity aliases, nearby payout figures, large numerical disagreement, different session conditions, an ambiguous incomplete report, explicit contradictions, an inconclusive observation, a copied report, repeated author and stale report. URLs use `example.invalid`; none are real community citations or asserted current GTA facts.

FixtureProvider replays pre-authored candidates. This validates pipeline mechanics, schema enforcement, filtering and scoring on constructed cases; it does **not** measure actual LLM quality. Labels are evaluation-only; they never enter the production source item records. Fresh evaluation run:

```text
25 processed | 17 useful (68%) | 7 claims | 10 reports merged
1 ambiguous | 2 contradictions | 0 errors | 0 paid LLM calls
UNVERIFIED 5 | DEVELOPING 1 | LIKELY 1 | VERIFIED 0
Fixture useful precision/recall: 100% / 100%
Dedup pair precision/recall: 100% / 100% (26 true-positive pairs)
Stance accuracy: 100% | Ambiguity preserved: true
```

These scores are synthetic mechanical checks, not a market validation result. Tests cover filtering, strict runtime validation, condition-sensitive matching, score/status transitions, copy independence, contradiction/numeric/age penalties, evidence attachment, idempotency, review/reassignment, transactional rollback, invalid-provider error retention/retry, and unapproved Reddit refusal.

`npm run evaluate` emits a JSON report with source counts, useful percentage, claims, merges, ambiguity, contradictions, statuses, errors, usage and quality metrics. Generated evaluation reports stay local and are excluded from this repository. API errors are cumulative events; successfully retried sources do not erase prior errors. Token totals are null when unavailable; costs are null if pricing/usage is unknown, 0 for fixture replay. Costs use configured per-million input/output rates. Failed API calls may lack token counts; usage records retain the failed attempt with unknown cost.

## First live source: staged Reddit pilot

The existing Reddit adapter now supports a deliberate mixture of new/hot/top-week/search-month posts and bounded comment trees across configured communities. It uses approved OAuth API endpoints only. Configure communities and discovery topics in `config/reddit-pilot.json`; add approval/token/User-Agent and LLM credentials/prices to `.env`. No Reddit or paid LLM request has been made in this environment.

See **[docs/REDDIT_PILOT.md](docs/REDDIT_PILOT.md)** for access requirements, configuration, cost guardrails, conversation context, human labels, metrics and the full command sequence. The default live database is separate (`data/reddit-pilot.sqlite`); fixture data and human fixture labels do not enter live reports.

```powershell
npm.cmd run pilot:auth
npm.cmd run pilot:smoke
# If configured, process the 10 stored items using the real LLM:
npm.cmd run pilot:process
npm.cmd run pilot:report
```

Inspect the smoke and record its approval with `pilot:approve`; then use `pilot:intelligence` for 50 items. The larger 200–500 item stage is gated on an inspected, processed 50-item test with at least ten human source labels. Source/call/spend caps persist across invocations and stop before the next estimated over-budget call. Pending/unknown call costs block further calls. `pilot:report` never claims usefulness without human labels; `pilot:label` and the dashboard capture them separately from claims. `pilot:export` creates a private benchmark, and `pilot:reset` removes only current live-pilot data.

All original fixture tests pass alongside pilot tests for mocked API parsing/pagination/rate limits, sampling, context, thread independence, budgets, stage gates, labels, metrics and selective reset. Mocked responses establish implementation behavior; they do not establish live access or real player usefulness.

## Extension points and weaknesses

Add a SourceAdapter for Twitch text/chat (with permission), YouTube permitted text/comments API, licensed forum feeds, web feeds, or direct user submissions. Emit the same platform/source IDs, timestamps, author/independence keys and raw metadata. Preserve known parent/copy attribution. No video/audio recognition is part of V0. Add/replace extraction providers behind the existing interface. Any future model-assisted matching should log usage under MATCH and preserve review gates.

Current weaknesses: limited alias coverage and crude cheap filter; lexical predicate similarity across live LLM wording; no embedding matcher; no causal truth check; incomplete independence detection beyond author/thread/copy heuristics; first numeric observation can anchor agreement incorrectly; no patch/version expiration beyond extracted conditions and recency; no automatic source edits/deletions or token refresh; bounded top-sorted comment trees without more-node expansion; no new-reply monitoring on previously sampled threads; per-record JSON and whole-table scans; cumulative logs need retention limits; one writer/no distributed worker coordination. Live provider/schema/access remain unverified. Human metrics depend on a representative reviewed sample; neither confidence nor high fixture accuracy establishes real player usefulness.

**Recommended next step:** follow `docs/V0_EVALUATION_PLAN.md`: obtain authorized source access and permission for downstream extraction, validate the provider on a small human-labeled sample, then run a capped 48–72 hour GTA Online pilot. If access is delayed, use manually permissioned text fixtures through a new adapter and the real LLM provider; do not substitute scraping. Prioritize useful precision and auditability before more ingestion volume.



