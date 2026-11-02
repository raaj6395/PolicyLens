# PolicyLens: Approach

PolicyLens turns a messy pre-authorization packet into an auditable medical-necessity recommendation: `LIKELY_APPROVE`, `NEED_MORE_INFO` or `LIKELY_DENY`, with every claim traced to a verified quote.

## 1. The core idea

The model reads and writes, and code decides. The LLM does what it is good at: it reads unstructured notes, finds facts, maps them to policy wording and drafts questions. Everything that must be reliable and explainable runs as deterministic Go code: quote verification, reference integrity, the verdict, and confidence.

This split makes the hardest requirement enforceable instead of hoped for. The requirement is telling *missing paperwork* (`NEED_MORE_INFO`) apart from *not necessary* (`LIKELY_DENY`). The LLM only labels each criterion. A pure function turns those labels into the verdict, and its rules are unit-tested and printed in the trace.

## 2. Pipeline

```
documents + policy
   │
   ├─ ingest ................ code   validate request, assign D1..Dn
   ├─ extract ............... LLM 1  30-aspect Patient Fact Sheet + policy measurements, verbatim quotes  (internal/extract)
   ├─ validate_facts ........ code   every quote must be in its document; FOUND without a verified quote → MISSING  (internal/validate)
   ├─ assess ................ LLM 2  signals + policy split into C1..Cn, evidence → reasoning → status  (internal/assess)
   ├─ validate_assessment ... code   fact refs exist; MET/UNMET need a real fact; UNMET can't rest on a "missing records" note
   ├─ decide ................ code   rules → recommendation, necessity category, workflow state, confidence  (internal/decide)
   ├─ queries ............... LLM 3  one provider query per gap + appeal direction  (internal/queries)
   └─ assemble .............. code   output contract + trace
```

- **Structured output and retry.** Each LLM output is checked against a JSON Schema in `skill/schemas/` plus semantic rules (unknown fact IDs, MET without evidence). On failure the call is retried once, with the errors appended. If the semantic check still fails, code repairs the output conservatively (it downgrades to `NOT_ASSESSABLE`) and logs the repair.
- **Code guardrails in `validate_assessment`.** Each one is logged as a check in the trace:
  - MET/UNMET must cite a FOUND or CONFLICT fact; otherwise the status becomes NOT_ASSESSABLE.
  - An UNMET whose only evidence is a "Missing records" fact becomes NOT_ASSESSABLE. A missing note is a paperwork gap, not proof of non-necessity.
  - A MET that cites a packet-reported gap for itself becomes PARTIALLY_MET. The prompt lists every reported gap and asks the model to *link* gaps to criteria. Linking proved more reliable than asking it to *judge* whether a gap applies.
  - With no policy, a core NOT_ASSESSABLE criterion with no evidence becomes non-core. A requirement that neither a policy nor the packet mentions cannot block a case. This stops invented "no contraindications" criteria from turning approvals into pends.
- **Policy measurements.** Extraction also receives the policy, only to learn which numeric thresholds matter (BMI, a disease-activity score, a test value). Any such value that none of the 30 aspects holds is added as an extra fact (F31+, category "Policy measurement"). Without this, a value the policy hinges on is silently dropped and the assessment can only call it missing (see `error_analysis.md`, 1.9.0). The policy is never quoted as a source.
- **Evidence before status.** The assessment schema orders `evidence → reasoning → status`, so the model has to cite before it judges.
- **Quotes are re-anchored.** A verified quote is replaced with the exact source substring and its character span. The demo highlights that span, and the API returns it.

### Readability: IDs for machines, names for people

Every reference in the API stays an ID (`D3`, `F12`, `C4`), because stable IDs are what make the output auditable. People see names:
- Each criterion carries a model-written `label` (2–4 words). The decision explanation, the confidence penalties and the code-written `bottom_line` are all built from those labels.
- Skill hard rule 6 tells the model never to write IDs in prose.
- As a backstop, the UI formatter (`web/src/ui.tsx`, `Humane`) turns any `D#`/`F#` left in prose into a named chip you can click. It also does this for `C#`, except where the token looks anatomical: a range like `C5-C6`, a phrase like "C6 distribution", or "at C5". Spinal levels are never renamed.

The result page also has: plain status words (Satisfied / Partly shown / Not satisfied / No information), dates shown as "12 Oct 2026 · 7 days before the request", Agree/Override feedback, a print/PDF report, and plain-language error states for provider billing, rate-limit and key errors.

## 3. Decision rules (`internal/decide.Decide`)

| Rule | Condition | Result |
|---|---|---|
| *(first)* | criteria sharing an `any_of_group` (policy says "ANY of") collapse into one: MET if any alternative is MET, else the best remaining status | — |
| `no_criteria` | nothing assessable | NEED_MORE_INFO, LOW |
| `core_unmet` | a core criterion is UNMET (documented absent or below threshold) | LIKELY_DENY · NOT_NECESSARY_UNDER_POLICY |
| `partial_or_not_assessable` | a core criterion is PARTIALLY_MET / NOT_ASSESSABLE, or a non-core one is UNMET | NEED_MORE_INFO · PLAUSIBLE_INCOMPLETE · PEND_FOR_CLINICALS |
| `core_met_admin_gap` | all core MET, only non-core packet items incomplete (PA-010) | LIKELY_APPROVE, −0.10 confidence |
| `all_met` | everything MET | LIKELY_APPROVE · SUPPORTED_DOCUMENTED |

The LLM marks each criterion `core` or not. Core means clinical necessity and explicit policy prerequisites (TB screening, nicotine window). Non-core means packet-completeness items only. That flag is why PA-009 (unclear nicotine date → pend) and PA-010 (missing coronary summary → approve) come out differently.

**Confidence** is arithmetic, not a model opinion. It starts at 0.90 and subtracts 0.05 per contradiction, 0.08 per NOT_ASSESSABLE, 0.06 per PARTIALLY_MET, 0.02 per dropped quote (capped at 0.10), 0.10 for the admin-gap rule, and 0.30 when no policy is supplied (score capped at 0.45). The result maps to ≥0.75 HIGH, ≥0.50 MEDIUM, otherwise LOW. The rationale string lists every penalty.

## 4. How the skill "learns from denial trends"

The workbook has 10 labeled one-line cases. That is too few to train on, so the learning is materialized as **readable, versioned skill content**, with no fine-tuning:

1. **Patterns** (`SKILL.md` §Patterns): one rule per training case, tagged with its case ID. See `docs/denial_patterns.md` for the analysis.
2. **Generic rules** distilled from the patterns: status definitions, the documentation-gap rule, the source hierarchy, and core vs. administrative.
3. **Few-shot examples** (`skill/examples/`): generated from the workbook by `cmd/seed`. They cover each case's packet, label, *why* and *what would flip it*, plus the complex-case criterion table and provider-query style.
4. **Code guardrails**: rules too important to leave to the prompt (for example, an UNMET resting only on a "documentation missing" note is downgraded).

Every change bumps `skill/VERSION`. The version is stamped on every response and trace.

## 5. Leakage control

- **Leave-one-out eval.** Each training case runs with its own example and pattern withheld.
- **Optional `exclude_examples`.** Callers can withhold specific few-shot cases when the live packet overlaps a training scenario (same patient, same service).
- **Generic sections stay generic.** During development, a generic rule quoted phrases from specific cases ("no rising tumor markers"), which leaked those cases into leave-one-out. It was rewritten. Case-specific knowledge lives only in tagged pattern lines.
- **Fixtures never contain answer columns** (`Expected_Outcome`, `Why`, `If Additional Documentation Arrives`, `Complexity_Notes`).

## 6. Input packets

- **Bundled fixtures** (`data/fixtures/PA-001.json` … `PA-010.json`): three short documents each (request form, clinical summary, UR note), built from the workbook training scenarios. There is no policy text, so they run under the no-policy fallback, and confidence is always LOW.
- **Assignment complex case:** not committed to this repo. Run it by POSTing the full packet and policy to `/v1/assess` from your copy of the workbook.

## 7. Stack choices

- **Go**, standard library HTTP (Go 1.22+ routing), `log/slog`. The only dependency is `santhosh-tekuri/jsonschema`.
- **One OpenAI-compatible client** (`internal/llm`) covers Gemini (its OpenAI endpoint, with `json_schema` structured output), OpenAI and Groq (JSON mode) and Ollama (local or Ollama Cloud), chosen with `LLM_PROVIDER`. This replaced the planned Gemini Go SDK: one ~150-line client instead of two SDK integrations. Groq and Ollama run in JSON mode, with the schema given in the prompt and enforced by the validator. Runs in this repo used `gpt-oss:120b-cloud` via Ollama, because no Gemini or Groq key was available.
- **Workbook parsing**: the pack arrived as markdown exports of each sheet, so `cmd/seed` parses the markdown tables and `excelize` was not needed.
- **Traces**: an in-memory store with a TTL behind a two-method interface. Optional embedded eval traces let the demo open training-case runs without an LLM call when reports exist under `data/eval/`.
- **Frontend**: React + Vite + Tailwind, embedded with `go:embed`. A single binary serves both the API and the demo.

## 8. Assumptions and limitations

- Bundled training cases have no payer policy in the fixture; they are judged on learned patterns alone (the no-policy fallback), which is why their confidence is LOW. Full policy-driven reviews require the caller to supply policy text on `/v1/assess`.
- The training cases are one-line summaries, so their packets are thin. Real packets will be longer, noisier and more contradictory.
- C1–C6 IDs are compared positionally against the workbook. The model is told to follow the policy's order, but a reordered split would show as mismatches.
- Free or cloud-hosted models vary between runs even at temperature 0. The eval reports the model used. Rerun before trusting a single number.
- Output is a recommendation for a human reviewer, not a coverage decision.
- The API-key check and per-IP rate limit are demo-grade (`X-Forwarded-For` last hop, in-memory).
