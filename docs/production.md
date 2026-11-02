# Production Deployment Recommendations

What it would take to move this from a demo to a system a UM team relies on.

## 1. Human in the loop

- PolicyLens pre-fills the review; a licensed reviewer signs off. `LIKELY_DENY` should **never** auto-issue. Route it to a physician reviewer with the criteria board and quotes attached.
- `NEED_MORE_INFO` + `PEND_FOR_CLINICALS` can auto-send the generated provider queries after a nurse reviewer approves the wording, because those queries are the actionable part.
- Capture reviewer overrides as structured feedback (`POST /v1/feedback`: trace ID, correct label, reason). This becomes the labeled data the skill improves from.

## 2. Improvement loop

1. Collect overrides weekly and group them by root cause: extraction miss, wrong criterion status, missing pattern, or policy split error.
2. Fix the skill: add a pattern line, tighten a status definition, add an example, or add a code guardrail.
3. Bump `skill/VERSION` and rerun the full eval (leave-one-out plus a frozen holdout set) as a regression gate. Ship only if accuracy and the more-info↔deny confusion count do not regress.
4. Later, once there are hundreds of corrected cases, retrieve the most similar ones into the prompt instead of using a fixed few-shot list.

## 3. Policies

- Store payer policies as versioned documents and pre-split them into criteria once per version, with a human checking the split. Then cache the split, and pass criteria IDs and texts in, rather than re-splitting on every request. This removes run-to-run variation in C1..Cn and makes criterion-level analytics possible.
- Record the policy version in every trace (already done via `policy_used`).

## 4. Reliability and cost

- Use a paid tier with a pinned model version and strict structured output (Gemini `responseSchema`, or OpenAI-style `json_schema`). Keep the validator and retry.
- Run calls 2 and 3 on a smaller or cheaper model if the eval allows. Extraction quality matters most.
- Use prompt caching for the static SKILL.md and examples prefix, which is most of the tokens.
- Queue requests (one worker pool per provider quota) instead of running synchronously, and expose the existing async mode (`?async=true` plus polling) as the default.
- Approximate cost per case today: 3 calls, ~15–25k input tokens, ~4–6k output tokens.

## 5. Monitoring

- Per skill version: label distribution, more-info↔deny override rate, dropped-quote rate, retry rate, the share of criteria downgraded by guardrails, and latency per stage. Every one of these is already in the trace.
- Alert on drift: a sudden jump in `LIKELY_DENY` share or in dropped quotes usually means a model or prompt regression.
- Keep traces for the audit retention period. They are the evidence for why a recommendation was made.

## 6. PHI / HIPAA

- Sign a BAA with the LLM provider, or self-host the model. Do not send PHI to free tiers.
- Encrypt traces at rest (they contain document text and prompts). Restrict trace access by role, and log every trace read.
- Logs are already restricted to IDs, case IDs, provider and status. Keep document text out of logs.
- Replace the demo API key with per-client credentials (OAuth client credentials or mTLS), and add per-tenant rate limits and quotas.
- Swap the in-memory trace store for Postgres or SQLite behind the existing `trace.Store` interface.

## 7. Model governance

- Pin model versions. Treat a model change like a code change: run the eval, compare against the last approved version, record the result.
- Keep a frozen, reviewer-labeled holdout set that is never used for examples or patterns.
- Version and review every change to `SKILL.md`, examples and schemas like code (PR plus eval diff).
