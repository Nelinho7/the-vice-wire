# V0 evaluation: 48–72 hours of GTA V / GTA Online

## Decision

Determine whether noisy community observations can yield timely, actionable, traceable player intelligence. Success is useful claims, not collected-post counts. Fixture scores alone cannot answer this question.

## Gate before the clock starts

1. Run tests and synthetic evaluation. Keep their report as a regression baseline.
2. Obtain explicit approved API/feed access and permission for downstream LLM processing for the exact prototype use. Configure one source and provider; keep credentials in `.env`. If access is unavailable, use an authorized manually collected text dataset via a SourceAdapter, and describe that as an offline pilot rather than a live 72-hour run.
3. Follow `REDDIT_PILOT.md` through auth, 10-item smoke and the 50-item intelligence stage. Label a **separate 50–100-item sample** including posts/comments with useful intel, chatter, unanswered questions, copies, numerical disagreements, platform/session/version differences and contradictions. Do not embed answer labels in prompts. Have two people independently review, resolve disagreements and preserve original labels. Use the new dashboard source evaluation or `pilot:label`; `pilot:report` calculates human-reviewed pilot metrics. `npm run evaluate` still measures synthetic fixtures only. Labels are never sent to the real extraction provider.
4. Record provider/model, prompt/schema and matching/scoring versions, approved API limits, expected source coverage, per-token pricing and budget. Configure cumulative source/call/estimated-spend caps in `.env`; the pilot reserves costs and stops safely at limits or unknown usage. Include non-LLM costs in `PILOT_OTHER_COST`. Check the first 10 outputs for schema compliance, evidence fidelity and excessive costs. Never silently fall back to fixture answers on failure. See `REDDIT_PILOT.md` for estimate assumptions and stage approvals.
5. Use a fresh local database and an evaluation log. Confirm secrets and personal data are excluded from shared reports. Establish allowed retention and source deletion obligations; V0 cannot reconcile source deletions automatically, so handle them manually or defer live retention until implemented.

## Run schedule

**Hour 0–4:** Use one subreddit/feed and one game context. Run capped batches manually; verify URLs, game/platform/session conditions, no invented quotes, and cost accounting. Label all surfaced claims and a random sample of rejected items. Fix only blocking defects; record each version change and keep before/after results separate.

**Hour 4–48:** After the 50-item gate, invoke bounded `pilot:ingest` and `pilot:process` at an approved cadence. Do not use the fixture worker for Reddit. Inspect counts and source timestamps every 4–6 hours; identify coverage gaps and top-sorted comment bias. Review every newly surfaced claim (target 30+ distinct useful propositions), every ambiguous match and all contradictions. Inspect at least 100 randomly sampled rejected items across the run, or all if fewer; avoid only reviewing obvious rejects. Track reviewer time and reassignment frequency. Include a late-day sample to catch changed bonuses/patches. Stop at configured caps/access errors; no bypass.

**Hour 48–72:** Continue if the sample is too small or conditions changed. Do not extend solely to collect more posts. Re-test a minimum of 10 actionable claims in-game or against an authoritative permitted reference where practical. Record test game/platform/patch/session/upgrades and results. For money, measure payout under stated conditions; for bugs/workarounds reproduce the trigger and attempted fix. A claim without testable conditions is incomplete. Capture both positive and negative outcomes as evaluation data. Recompute confidence at the end and examine staleness.

## Human labeling and measurements

Keep one row per source and one row per normalized claim. Source labels: useful/non-useful, rejection reason, claim group, stance, copy attribution, missing conditions, actionable value. Claim labels: valid/invalid/duplicate/needs review; precision of normalized entity/condition/value fields; evidence quote fidelity; whether a player could act on it; in-game outcome; review minutes. Use UI review notes with a structured convention (e.g. `actionable=yes; tested=pass; platform=PC; reviewer=R1`) or a separate evaluation sheet. UI decisions persist but are not automatically ground-truth quality metrics.

- Useful precision = true useful surfaced propositions / all surfaced propositions after human dedup.
- Useful recall = useful labeled source observations reaching a correct claim / all useful labeled observations. Estimate from a random source sample including rejected items, not from claim-only review.
- Dedup precision/recall = correct merged pairs / merged pairs and correct merged pairs / expected same-claim pairs. Report missing-condition ambiguity separately.
- Stance accuracy = correct supporting/contradicting/uncertain labels / labeled evidence items.
- Fidelity = correct entity, numerical and condition fields; quote must be verbatim and entail the observation.
- Timeliness = source publication to first detection; report median and p90, plus sampling-window gaps.
- Calibration = observed correctness by confidence band (0–39, 40–64, 65–84, 85–95) and by status. Count contradicted VERIFIED claims explicitly.
- Efficiency = actual LLM calls/tokens/cost per accepted useful claim and reviewer minutes per useful claim, with unknown usage clearly flagged.
- Auditability = percentage of claims with reachable permitted source, original text, quote, match reason and score breakdown.

Use `pilot:report` and the dashboard pilot metrics for operational and human-labeled source metrics. Machine useful percentage is not human-reviewed precision. Report reviewer-label denominators and the “Would I show this to a GTA player?” approval share/unique claim IDs. Pairwise match precision/recall, stance accuracy, confidence calibration, reviewer time and in-game outcomes still need separate benchmark analysis; the requested quick source labels do not measure all of them. The synthetic evaluate command is not a substitute for a real pilot.

## Proposed go/no-go gates

Freeze these gates before seeing pilot outputs:

| Measure | Proposed threshold |
|---|---|
| Distinct actionable claims | At least 20 human-accepted claims covering 3+ categories; insufficient sample means inconclusive |
| Useful claim precision | ≥85%, with counts and uncertainty interval reported |
| Useful observation recall | ≥70% on randomly sampled labeled source items |
| Automatic merge precision | ≥95%; zero cross-game/session/platform merges in reviewed sample |
| Dedup recall | ≥75%; ambiguity retained for explicit review rather than forced merges |
| Stance accuracy | ≥90%; contradictions never silently treated as support |
| Entity/condition/numerical fidelity | ≥90% of reviewed claims; zero fabricated quotations |
| VERIFIED claims | No single-report/copy-driven verification; zero known false VERIFIED claims in sampled tests |
| Auditability | 100% have stored text, timestamp, evidence linkage, match decision and score breakdown |
| Timeliness | Median ≤30 minutes and p90 ≤60 minutes, within approved polling/source coverage |
| Review effort | Median ≤2 minutes per accepted useful claim |
| Cost | Within pre-agreed cap; target ≤$0.10 extraction cost per accepted claim, report actual and unknown usage |

These thresholds are hypotheses. Report confidence intervals and sample size; 20 claims are not enough to establish reliable calibration. If no VERIFIED claims emerge, calibration of that status is untested rather than passed. A slow permitted source can make timeliness inconclusive rather than an extraction failure.

## Final decision report

List source/access details and coverage, pipeline/provider versions, totals/errors/cost, quality table with denominators, rejection false negatives, mistaken merges, contradictory observations, copied-source examples, three genuinely useful success cases and three failures. Include in-game tests, reviewer effort and current unknowns. Keep synthetic and live results separate.

**GO:** quality gates met with enough samples; build only the next adapter/matcher improvement required by observed failures. **ITERATE:** useful signal exists but one or more correctable gates miss; fix filter/schema/conditions/matching and repeat an independent holdout. **NO-GO:** low useful precision, pervasive evidence fabrication, confidence driven by copies, or impractical access/cost/review burden. **INCONCLUSIVE:** inadequate approved access or sample size. No outcome authorizes building the consumer site or Informant List yet.
