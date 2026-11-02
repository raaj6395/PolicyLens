# PolicyLens - Claude Code Build Plan

This is the build plan for the Docstribe assignment: a reusable LLM skill that turns a messy pre-authorization packet into an auditable medical-necessity recommendation. It is exposed through one Go API and demonstrated through a frontend that shows how every decision was made. Read `context.md` and the workbook files in `data/` before writing code. The workbook is the source of truth wherever it disagrees with this plan.

## 1. Goals

- One Go backend with one public assessment API. Inside it, a single LLM provider runs the skill as a staged pipeline.
- The skill lives inside the backend: `SKILL.md` plus few-shot examples and output schemas, loaded at startup and versioned.
- Every response is auditable. Each claim links to a fact ID, and each fact links to a verbatim quote from the original document.
- The skill must keep three outcomes apart: supported and documented (LIKELY\_APPROVE), plausible but incomplete (NEED\_MORE\_INFO), and not necessary under the supplied policy (LIKELY\_DENY). Confusing the last two is the main failure to avoid.
- A demo frontend replays every pipeline stage. It should work for a non-technical audience and map cleanly to the code for a technical one.

## 2. Tech stack

- **Backend:** Go 1.22+, standard `net/http` with the Go 1.22 router (or chi), `log/slog` for logging.
- **LLM providers** (free tiers for testing), behind one interface:
  - **Gemini** via the official Go SDK `google.golang.org/genai`, using `ResponseSchema` and `application/json` for structured output. This is the default.
  - **Groq** via its OpenAI-compatible HTTP endpoint, using JSON mode. This is the fallback.
  - Select the provider with the `LLM_PROVIDER` env var and the model with `LLM_MODEL`. Never hardcode keys; read `GEMINI_API_KEY` and `GROQ_API_KEY` from env.
- **Schema validation:** `github.com/santhosh-tekuri/jsonschema/v5` against JSON Schemas stored in `skill/schemas/`.
- **Workbook parsing:** `github.com/xuri/excelize/v2`, used only by the eval and seeding tools.
- **Trace storage:** in-memory map with a TTL for the demo. Keep an interface so SQLite (`modernc.org/sqlite`, no CGO) can replace it later.
- **Frontend:** React + Vite + TypeScript + Tailwind. Build it to static files and serve them from the Go binary with `go:embed`, so one binary covers both the API and the demo.
- **Deploy:** one Dockerfile (multi-stage: Node builds the frontend, Go builds the binary, distroless runtime). Any free host that runs a container (Render, Fly.io, Railway) will do.

## 3. Architecture

One backend, one pipeline, two consumers:

- `POST /v1/assess` is the public API Docstribe calls. It returns the final structured result plus a `trace_id`.
- `GET /v1/traces/{id}` returns the full stage-by-stage trace for that run: inputs, prompts, raw LLM output, validation results, and the decision rule that fired. The demo frontend reads this.
- There is no separate demo backend. The demo is just a richer view of the same run, so what is demonstrated is exactly what the API does.

Pipeline per request:

1. **Ingest:** validate the request and assign stable IDs to each document (`D1`, `D2`, ...).
2. **Stage 2.1, fact extraction (LLM call 1):** raw documents become the Patient Fact Sheet, covering the 30 Patient Data Aspects.
3. **Validation A (code):** schema check, plus every quote must be found in its source document.
4. **Stages 2.2 + 2.3, signals and criteria matching (LLM call 2):** fact sheet + policy produce necessity signals and a status for each criterion.
5. **Validation B (code):** schema check, every fact reference must exist, and evidence-before-status rules must hold.
6. **Decision (code, deterministic):** criteria statuses produce the recommendation, necessity category, workflow state and confidence.
7. **Stage 2.4, provider queries and appeal (LLM call 3):** a code filter selects the gaps, then the LLM writes one targeted query per gap plus the appeal direction.
8. **Assemble:** build the output contract and store the trace.

Keep the stages as separate Go packages with plain structs passed between them. Each stage takes typed input and returns typed output plus a `StageTrace`.

## 4. Repository layout

```
policylens/
  cmd/
    server/main.go          # HTTP server + embedded frontend
    eval/main.go            # runs skill over training cases, writes report
    seed/main.go            # converts workbook sheets into JSON fixtures
  internal/
    api/                    # handlers, request/response types, middleware
    pipeline/               # orchestrator: runs stages, collects traces
    extract/                # stage 2.1
    assess/                 # stages 2.2 + 2.3
    decide/                 # deterministic decision rules
    queries/                # stage 2.4
    validate/               # schema + quote + fact-ref checks
    llm/                    # Provider interface, gemini.go, groq.go, retry
    skill/                  # loads SKILL.md, examples, schemas; version
    trace/                  # trace store interface + memory impl
  skill/
    SKILL.md                # the skill: rules, patterns, checklists
    examples/               # few-shot cases (JSON input -> expected output)
    schemas/                # fact_sheet, assessment, queries, output JSON schemas
    VERSION
  data/
    preauth_skill_assignment_pack_2.xlsx
    fixtures/               # generated JSON packets per case
  web/                      # React demo app
  docs/
    data_inventory.md
    denial_patterns.md
    design.md               # approach note (deliverable)
    error_analysis.md       # generated from eval + written analysis
    production.md           # deployment recommendations
  Dockerfile
  Makefile
  README.md
```

## 5. The skill (SKILL.md and friends)

`SKILL.md` is the brain. Every LLM call loads the relevant section into its system prompt. Write it from the training cases before building the pipeline. Sections:

1. **Role and hard rules:** judge only against the supplied policy; never invent facts; anything not in a document is MISSING; surface contradictions instead of picking one.
2. **Extraction guide:** the 30 Patient Data Aspects, with what to look for in each and the expected value types.
3. **Source hierarchy:** objective tests (MRI, EMG, echo, oximetry) outrank narrative notes; a recent specialist note outranks an older PCP note; always record the conflict.
4. **Criteria status definitions:** MET, PARTIALLY\_MET, UNMET, NOT\_ASSESSABLE, with the rule that no MET or UNMET is allowed without fact references, and that missing evidence means NOT\_ASSESSABLE, never UNMET.
5. **Patterns learned from training cases**, one per case, each with the case ID it came from. For example:
   - Strong clinical need plus a paperwork gap means NEED\_MORE\_INFO, never DENY (PA-001).
   - Pain language alone without instability or deficit leans DENY; do not over-weight pain (PA-002).
   - Aligned imaging, severity and failed conservative care means APPROVE; an elevated BMI is not an exclusion unless the policy says so (PA-003).
   - Symptoms without qualifying test values do not meet threshold-based criteria (PA-004).
   - Clinical need with pending safety prerequisites means NEED\_MORE\_INFO (PA-005, PA-009).
   - Asymptomatic low-risk surveillance with high-cost imaging leans DENY (PA-006).
   - Objective studies outweigh one vague note questioning the diagnosis (PA-007).
   - Post-acute site of care is judged on intensity, participation and safety criteria (PA-008).
   - A minor packet gap does not overturn a complete high-acuity specialist assessment (PA-010).
6. **Confidence calibration:** what lowers it (conflicts, NOT\_ASSESSABLE criteria, no supplied policy) and what supports HIGH.
7. **Provider query style:** one question per gap, naming the exact document or value and the criterion it would satisfy.
8. **Appeal direction style:** lead with the strongest MET evidence, then name the exact document that would flip the verdict.
9. **No-policy fallback:** if no policy text is supplied, state that clearly, fall back to the learned patterns only, cap confidence at LOW, and never return a confident LIKELY\_DENY.

Few-shot examples in `skill/examples/` are built from the training cases. **Leakage rule:** the complex case is the same patient as training case PA-001, so PA-001 must be excluded from the few-shot set when the complex case is run or evaluated. Document this in `design.md`.

Bump `skill/VERSION` on every change to `SKILL.md`, examples or schemas, and record the version in every trace and response.

## 6. API contract

`POST /v1/assess`

Request body:

```json
{
  "case_id": "PA-001",
  "documents": [
    {"name": "Surgeon consult", "type": "clinical_note", "date": "2026-09-01", "text": "..."},
    {"name": "MRI cervical spine", "type": "imaging", "text": "..."}
  ],
  "policy": {"name": "Commercial Spine Surgery Policy v2026.1", "text": "..."},
  "options": {"provider": "gemini", "exclude_examples": ["PA-001"]}
}
```

`documents` is required and holds raw text. `policy` is optional but strongly expected; without it the no-policy fallback applies. `date` is optional and used for temporal reasoning.

Response: the output contract from `context.md` section 7, plus `trace_id`, `skill_version`, `provider`, `model` and `necessity_category`. Every evidence item carries `fact_id`, `source_doc`, `doc_id` and `snippet`.

Other endpoints:

- `GET /v1/traces/{id}`: the full trace (see section 9).
- `GET /v1/cases`: lists the bundled demo fixtures (training cases + complex case).
- `POST /v1/cases/{id}/run`: runs a bundled fixture through the same pipeline.
- `GET /v1/skill`: returns the current SKILL.md, its version and the schemas, for the demo's skill tab.
- `GET /healthz`.

Errors return JSON `{error, code, details}`. Add a simple API-key header (`X-API-Key`) and a per-IP rate limit, because free LLM quotas are small.

## 7. Stage details

### 7.1 Fact extraction (LLM call 1)

- Input: documents with IDs, plus the extraction section of SKILL.md.
- Output: a fact sheet with one entry per aspect, as an array, with fact IDs `F1`...`F30` and more for multi-valued facts: `{fact_id, category, aspect, value, status: FOUND|MISSING|CONFLICT, sources: [{doc_id, quote, date}]}`.
- CONFLICT keeps every conflicting source and value; it never resolves them here.

### 7.2 Signals and criteria matching (LLM call 2)

- Input: fact sheet, policy text, the patterns and status-definition sections of SKILL.md, and few-shot examples.
- The LLM first splits the policy into criteria `C1`...`Cn`, keeping the verbatim criterion text.
- Signals: `{group: necessity|contraindication|failed_treatment|severity|site_of_care, fact_refs, effect: SUPPORTS|WEAKENS, strength: STRONG|MODERATE|WEAK}`, or `NOT_FOUND` for a group with no evidence.
- Criteria: the JSON schema enforces field order `evidence (fact_refs + quotes) -> reasoning -> status`, so the model writes evidence before deciding.
- Contradictions: `{issue, fact_refs, preferred_source, why}`.

### 7.3 Decision rules (code, no LLM)

Implement in `internal/decide` as a pure, unit-tested function:

- Any criterion UNMET with complete documentation leads to **LIKELY\_DENY**, category NOT\_NECESSARY\_UNDER\_POLICY.
- Otherwise, any PARTIALLY\_MET or NOT\_ASSESSABLE leads to **NEED\_MORE\_INFO**, category PLAUSIBLE\_INCOMPLETE, workflow PEND\_FOR\_CLINICALS.
- All criteria MET leads to **LIKELY\_APPROVE**, category SUPPORTED\_DOCUMENTED.
- Edge rule from PA-010: a NOT\_ASSESSABLE on a non-core administrative item, with every core clinical criterion MET, can still be LIKELY\_APPROVE. Make "core vs administrative" a field the LLM sets per criterion, and make the rule explicit and logged.
- Confidence is computed in code from counts: base by verdict, minus penalties for each conflict, each NOT\_ASSESSABLE, each dropped quote, and a missing policy. Map the score to HIGH, MEDIUM or LOW and generate the rationale string from the penalties applied.
- Record which rule fired in the trace.

### 7.4 Provider queries and appeal (LLM call 3)

- A code filter picks the PARTIALLY\_MET and NOT\_ASSESSABLE criteria and the NOT\_FOUND signal groups.
- For each gap, the LLM receives the criterion, the reasoning (what is lacking) and the evidence found so far, and writes one query naming the exact document or value needed and the criterion it satisfies.
- Appeal direction: strongest MET evidence first, then the specific document that would flip the verdict.
- Few-shot sources: the provider query and "flip to approve" rows from `05_Complex_Case_Outcome`, and the "If Additional Documentation Arrives" column from `02_Training_Cases`.
- Skip this call for LIKELY\_APPROVE with no gaps.

## 8. Guardrails and validation

- **Structured output plus retry:** validate every LLM response against its JSON Schema. On failure, retry once with the validation errors appended, then fail the stage with a clear error. Write this retry loop in `internal/llm` (Go has no Instructor equivalent).
- **Quote verification:** normalize whitespace, case and punctuation, then check that each quote is a substring of its source document. Allow a small fuzzy tolerance (token overlap of at least 0.9). Drop or flag unmatched quotes, and record each check in the trace.
- **Fact-reference integrity:** every `fact_ref` must exist in the fact sheet, and every criterion with MET or UNMET must have at least one ref.
- **No hallucinated facts:** a fact with `status: FOUND` and no verified quote is downgraded to MISSING and flagged.
- **Determinism:** temperature 0, fixed model version, and the prompt hash stored in the trace.
- **PHI hygiene:** the data is synthetic, but log only IDs and hashes, never full document text, at info level.

## 9. Trace format (powers the demo)

```json
{
  "trace_id": "...",
  "skill_version": "1.0.0",
  "provider": "gemini",
  "stages": [
    {
      "name": "extract",
      "started_at": "...",
      "duration_ms": 0,
      "input_summary": {},
      "prompt": {"system_hash": "...", "skill_sections": ["extraction"]},
      "raw_output": "...",
      "parsed": {},
      "validations": [{"check": "quote_in_source", "target": "F20", "passed": true, "detail": "..."}],
      "retries": 0
    }
  ],
  "decision": {"rule_fired": "partial_or_not_assessable", "inputs": {}, "confidence_penalties": []},
  "result": {}
}
```

## 10. Demo frontend

Purpose: let Ankit explain the system first to a non-technical person, then to a technical one, using the same screen. Add an **"Explain simply" / "Technical"** toggle that changes the labels and detail level, not the data.

Pages and panels:

1. **Case picker:** choose a bundled case (training cases or the complex case) or paste or upload a custom packet. A Run button shows a live stage progress bar.
2. **Pipeline view:** a horizontal stepper (Ingest, Facts, Signals + Criteria, Checks, Decision, Queries), each step clickable, showing its duration and pass/fail checks.
3. **Documents panel:** the raw documents, side by side with the results. Clicking any fact, criterion or evidence highlights the exact quoted span in the source document. This is the core of the demo.
4. **Fact sheet:** a table of the 30 aspects with FOUND, MISSING and CONFLICT badges; conflicts expand to show both sources.
5. **Criteria board:** one card per criterion with a status color, verbatim criterion text, the reasoning, and evidence chips that link back to facts and documents.
6. **Decision explainer:** shows the rule that fired in plain words (for example: "No criterion failed, but C4, C5 and C6 are incomplete, so this is a paperwork gap and not a denial"), plus the confidence breakdown listing each penalty.
7. **Provider queries and appeal:** each query is tagged with the criterion it fixes.
8. **Validation log (technical mode):** every check with pass/fail, retries, raw LLM output, prompt hash and skill version.
9. **Skill tab:** renders SKILL.md and the schemas, so people can see that the logic is a readable, versioned file and not hidden in the model.
10. **Eval dashboard:** label accuracy, a 3x3 confusion matrix (APPROVE / MORE\_INFO / DENY) and per-case pass/fail with diffs against the expected outcome.

**Full JSON response panel (required):** every run shows the complete API response JSON exactly as returned, pretty-printed and collapsible, with copy and download buttons. Clicking a field in the JSON (for example `criteria_assessment[3]`) highlights the matching card and the source quote, and clicking a card scrolls the JSON to its field. A second tab shows the full trace JSON. `POST /v1/assess?include_trace=true` returns the result and the trace in one JSON body, so the same view also works for any curl call.

**Decision journey view (the main demo screen):** one vertical flow that reads top to bottom like a story and ends in the verdict. Each step is a node that shows what came in, what it produced, and the checks it passed: Documents received (9 docs) -> Facts extracted (for example 27 FOUND, 2 MISSING, 1 CONFLICT) -> Criteria judged (C1-C6 as colored chips) -> Checks (quotes verified) -> Rule fired -> **Verdict badge** (LIKELY\_APPROVE green, NEED\_MORE\_INFO amber, LIKELY\_DENY red) with a one-line plain-English reason, then the confidence and the provider queries. Arrows connect each criterion chip to the facts and quotes it used, so anyone can trace backwards from the verdict to the exact document line. Nodes animate in as each stage finishes during a live run. Every node expands to its JSON in the full JSON panel.

In technical mode, each panel shows a small "code" link naming the Go package and function that produced it (for example `internal/decide.Decide`), so the walkthrough can jump straight into the codebase.

## 11. Evaluation harness

`cmd/eval` (also exposed in the frontend):

- Seed: convert the 10 training cases into JSON packets in `data/fixtures/`. They are one-line summaries, so present each as a short synthetic packet built only from the sheet's columns, and record that assumption.
- Run every fixture through the real pipeline and compare against `Expected_Outcome`, using leave-one-out for few-shot (never include a case's own example).
- Report label accuracy, the confusion matrix, an explicit count of NEED\_MORE\_INFO vs LIKELY\_DENY confusions, and for the complex case a per-criterion comparison against `05_Complex_Case_Outcome` (C1-C6).
- Write `docs/error_analysis.md` with one entry per miss: what the skill said, what was expected, root cause (extraction / criterion judgment / missing pattern) and the fix applied to SKILL.md.

## 12. Feedback loop (document; implement minimally)

- `POST /v1/feedback {trace_id, correct_label, reason}` stores corrections.
- Process: collect corrections, analyse the root cause, update SKILL.md or the examples, bump the version, re-run the full eval as a regression test, and ship only if it does not regress.
- Later improvement: retrieve similar corrected cases into the prompt automatically.

## 13. Build order (milestones)

Confirm with Ankit at the end of each milestone before moving on.

1. **Data inventory:** open the workbook, list every sheet, column and row count in `docs/data_inventory.md`, and write `docs/denial_patterns.md` from the training cases.
2. **Skill draft:** write `SKILL.md`, the JSON schemas and the few-shot examples.
3. **Backend skeleton:** server, config, the LLM provider interface with Gemini and Groq, the retry and validation loop, and the trace store.
4. **Pipeline:** stages 2.1, 2.2 + 2.3, decision, then 2.4, each with unit tests (decision rules and quote verification get table-driven tests).
5. **Complex case run:** produce the full output for the complex case and save it as `docs/complex_case_output.json` plus a readable markdown version.
6. **Eval harness:** run the 10 training cases, produce the report and write the error analysis.
7. **Frontend:** case picker, pipeline view, document highlighting, criteria board, decision explainer, then the technical panels and the eval dashboard.
8. **Deploy:** Dockerfile, a public URL, a README with curl examples, and sample request files.
9. **Docs:** `design.md` (approach), `production.md` (scaling, human-in-the-loop, monitoring, PHI/HIPAA, model governance, cost), plus assumptions and limitations.

## 14. Assumptions and limitations to state

- Only the complex case has explicit policy criteria; the other training cases provide outcomes and reasons, not policy text.
- The training cases are one-line summaries, so the synthetic packets built from them are thin.
- The complex case is the same patient as PA-001, so leakage is handled by exclusion.
- Free-tier models have rate limits and some variance; the eval reports the model and version used.
- The output is a recommendation for a human reviewer, not an automated coverage decision.

## 15. Working rules for Claude Code

- Debug step by step and verify before claiming a cause; never guess.
- Keep code idiomatic Go, small packages, explicit errors and no global state, so Ankit can explain every line.
- Keep all written docs and code comments in English.
- Do not invent clinical facts or policy criteria in fixtures; take them only from the workbook.
