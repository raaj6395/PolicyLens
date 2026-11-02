# Docstribe handback — PolicyLens

## 1. Approach (short)

PolicyLens is a **reusable LLM skill** plus a **Go pipeline** that turns a messy prior-auth packet into an auditable recommendation: `LIKELY_APPROVE`, `NEED_MORE_INFO`, or `LIKELY_DENY`.

**Core design:** the model reads and labels; **code decides**. Stages: ingest → extract facts (30 aspects + policy measurements, verbatim quotes) → verify quotes in source text → assess each policy criterion → code guardrails (a documentation gap is never `UNMET`) → deterministic decision rules and confidence → provider queries and appeal text.

Learning from the workbook’s denial trends is **not fine-tuning**. It is versioned skill content: pattern lines in `skill/SKILL.md`, few-shot examples in `skill/examples/`, JSON schemas, and unit-tested decision logic in `internal/decide`.

Assignment-aligned summary: [approach.md](approach.md). Technical pipeline: [design.md](design.md).

## 2. Example output

The **workbook complex case is not stored in this repository** (no input packet, gold labels, or saved run output in git). To produce example output:

1. POST your packet and policy to the API (from your copy of the assignment workbook).
2. Save the JSON response and optional Print/PDF from the demo UI.

Bundled **training** snapshots (PA-001…PA-010, thin packets, no policy): run `POST /v1/cases/PA-001/run` or pick a case in the UI. Historical leave-one-out notes: [eval_results_loo.md](eval_results_loo.md) (10-case run; complex row removed from repo).

## 3. API to test the same skill

Server: `make run` → `http://localhost:8080` (set LLM keys in `.env`).

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/assess` | Any packet JSON (documents + optional policy) |
| `POST` | `/v1/assess?include_trace=true` | Result + full stage trace in one response |
| `POST` | `/v1/assess?async=true` | Returns `{trace_id}`; poll trace |
| `GET` | `/v1/traces/{id}` | Full trace (prompts, validations, decision) |
| `GET` | `/v1/cases` | Bundled training fixtures (PA-001…PA-010) |
| `POST` | `/v1/cases/{id}/run` | Run a bundled training case |
| `GET` | `/v1/skill` | Rulebook, schemas, examples |
| `GET` | `/v1/eval?mode=loo` | Eval report JSON (after `go run ./cmd/eval`) |
| `POST` | `/v1/feedback` | Reviewer override `{trace_id, correct_label, reason}` |

Example (minimal):

```bash
curl -s localhost:8080/v1/assess -H 'Content-Type: application/json' -d @examples/no_policy_request.json | jq '.recommendation, .bottom_line, .confidence'
```

Request shape and response contract: [README.md](../README.md#api).

## 4. Assumptions, limitations, suggested improvements

**Assumptions**

- Reviewers judge against the **supplied policy excerpt** only; the skill does not substitute general medical knowledge.
- Output is a **recommendation for a human UM reviewer**, not an auto-denial or coverage determination.
- Callers can pass `options.exclude_examples` to withhold specific few-shot cases when the packet overlaps a training scenario (e.g. same patient as PA-001).

**Limitations**

- Bundled fixtures are the 10 one-line **training** cases without payer policy (no-policy fallback, LOW confidence). Full multi-document cases are supplied by the caller via `/v1/assess`.
- LLM outputs vary run-to-run even at low temperature; treat eval numbers as regression signals, not guarantees.
- Demo auth/rate limits and in-memory traces are not production-grade.

**Improvements** (see [production.md](production.md))

- Human-in-the-loop sign-off; never auto-issue `LIKELY_DENY`.
- Version and pre-split payer policies; cache criterion lists per policy version.
- Pin models, prompt caching, async queue as default, Postgres trace store, PHI/BAA governance.
- Close the loop with structured reviewer feedback into skill version bumps and eval gates.
