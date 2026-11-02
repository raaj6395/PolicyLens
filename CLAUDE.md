# PolicyLens — Docstribe Pre-Authorization Medical-Necessity Copilot (LLM Skill)

> Initial context for Claude Code. Read this file fully before writing any code.
> The **Excel workbook** shared by Docstribe is the primary source of truth. Wherever this file and the workbook disagree, the workbook wins.

---

## 1. What this project is

Docstribe is exploring a **copilot for the healthcare pre-authorization (prior-auth) workflow**.

**Pre-authorization, in plain terms:** before an insurer (payer) agrees to pay a hospital for certain procedures, tests, or admissions, a reviewer checks whether the request is **medically justified**. They look at the patient's condition, treatment history, test results, and clinical documentation, and compare that against the **payer's policy criteria**. The outcome is approve, deny, or "send us more documentation."

Today this review is manual, slow, and inconsistent, because the input is a messy packet of documents from many sources, often contradictory or incomplete.

**This assignment:** build a **reusable LLM skill** (an agentic, repeatable capability — not a one-off prompt) that takes such a messy packet and returns an **auditable, payer-defensible medical-necessity recommendation**.

### What Docstribe is actually evaluating
This is **not** a test of healthcare knowledge. It evaluates how well I:
1. **Structure messy multi-source data** (structured + unstructured).
2. **Design a reusable LLM skill** (clear stages, schema, prompts, guardrails).
3. **Reason over evidence and missing information** — and tell "missing paperwork" apart from "genuinely not necessary."
4. **Produce a clear, auditable outcome** — every claim traceable to a source snippet.

Deep medical judgment is not expected. The system's quality comes from extraction, criteria matching, uncertainty handling, and explanation — not from the model "being a doctor."

---

## 2. Problem statement (from the workbook's problem-statement sheet)

**Title:** LLM Skill Assignment: Pre-Authorization Medical Necessity Copilot

**Purpose:** Evaluate whether a reusable LLM skill can convert messy clinical packets into auditable medical-necessity recommendations for prior authorization.

| Section | Detail |
|---|---|
| **Objective** | Build a reusable skill for a pre-auth copilot that can ingest heterogeneous clinical and administrative data, extract clinically relevant evidence, match case facts against payer criteria, identify documentation gaps, and return a payer-defensible recommendation (Likely Approve / Need More Info / Likely Deny). |
| **Core tasks** | 1) Normalize messy patient data into structured facts. 2) Identify medical-necessity signals, contraindications, failed prior treatment, severity markers, and site-of-care justification. 3) Match facts to rule criteria and show which criteria are met, partially met, or unmet. 4) Generate provider clarification questions and appeal guidance. |
| **Input packet** | Clinical notes, H&P, progress notes, medication history, allergies, lab trends, imaging report, prior procedures, request form, payer policy excerpt, utilization review note, and any contradictory or missing documentation. |
| **Output contract** | Return a structured result containing: requested service, concise clinical summary, criteria met/unmet, recommendation, confidence, evidence snippets, missing information, provider query, and appeal direction. |
| **Evaluation** | Score on extraction accuracy, guideline matching, uncertainty handling, evidence traceability, actionability of provider queries, and ability to distinguish documentation gaps from true lack of medical necessity. |
| **Success definition** | The skill must **not hallucinate missing facts**. It must explicitly distinguish: **(a)** clinically supported and well documented, **(b)** clinically plausible but documentation incomplete, **(c)** not medically necessary under the supplied policy. |
| **Suggested deliverables** | Skill design doc; workflow / prompt or agent plan; structured schema; run results on 5–10 cases; error analysis; recommendations for production deployment. |
| **Suggested labels** | `LIKELY_APPROVE`, `NEED_MORE_INFO`, `LIKELY_DENY`. Optionally add `PEND_FOR_CLINICALS` if workflow state is separated from the medical-necessity opinion. |

---

## 3. The workbook (Excel pack) — what it contains

> **TODO for Claude Code:** the workbook must be placed in this repo (e.g. `data/`). Before designing anything, open every sheet, list sheet names, column headers, and row counts, and summarize them in `docs/data_inventory.md`. Do not assume structure — inspect it.

Per Docstribe, the pack contains:
1. **Problem statement sheet** — reproduced in Section 2 above.
2. **Multiple synthetic training cases** with known outcomes: **accepted**, **denied**, and **documentation gap**. These are the "trends of denials" the skill should learn from — i.e. which patterns lead to approval vs denial vs pend.
3. **One detailed complex case** — the case the skill must be run on and presented in the final output (Part 3).
4. **A list of patient / case data aspects** — the fields/dimensions that matter (useful as the backbone of the extraction schema).

How each is used:
- **Training cases** → derive denial/approval patterns, few-shot examples, a criteria checklist, and an **evaluation set** (we know the right label, so we can measure accuracy).
- **Data aspects list** → drives the canonical fact schema the extractor fills.
- **Complex case** → the showcase run; output must be complete and fully evidence-linked.

---

## 4. Objective (in Docstribe's words, restated)

> "A simple program which will learn through the trends of denials, develop a skill for an agentic LLM, and utilize that information to assess the deniability of the given case."

So the system has **two phases**:

1. **Skill creation (learning phase)** — analyze the labeled training cases to extract *why* cases were approved, denied, or pended. Turn those patterns into a reusable skill: criteria checklists, decision rules, red-flag patterns, few-shot exemplars, and prompts.
2. **Skill usage (inference phase)** — run that skill on a new packet (the complex case, or any case via the API) and produce the structured recommendation.

---

## 5. Things we have to achieve

### Part 1 — Understand the problem
Read the problem statement and all case sheets to understand:
- what the copilot is expected to do,
- what kind of evidence matters,
- what kind of information may be missing,
- how the final recommendation should be framed.

### Part 2 — Design the skill
An LLM-based skill that can:
- **ingest** the patient / request data (structured + unstructured),
- **extract** the relevant signals,
- **compare** them against approval logic / payer criteria,
- identify **what supports approval**,
- identify **what weakens the case**,
- clearly state whether the case is **likely acceptable, likely deniable, or needs more information**.

Focus is on reasoning over mixed information and explaining the output clearly — not on clinical expertise.

### Part 3 — Run the skill on the complex case
Show:
- summary of the case,
- important supporting evidence,
- missing / unclear information,
- likely recommendation,
- confidence level,
- additional documentation that could improve the outcome.

### Deliverables to hand back
1. **Short note / doc** explaining the approach.
2. **Example output** for the complex case.
3. **An API** Docstribe can call to test the same skill on their own cases.
4. **Assumptions, limitations, and suggested improvements.**

Also expected (from the workbook's suggested deliverables): structured schema, workflow / prompt / agent plan, **run results on 5–10 cases**, and **error analysis**, plus **production-deployment recommendations**.

Tech stack and methodology are my choice.

---

## 6. Hard requirements and guardrails

These come straight from the success definition and evaluation criteria. Treat them as non-negotiable.

1. **No hallucinated facts.** If a fact is not in the packet, it is *missing*, not assumed. Every extracted fact must carry a source reference (document name + snippet/quote).
2. **Three-way distinction is mandatory** on every run:
   - **(a) Supported & well documented** → `LIKELY_APPROVE`
   - **(b) Plausible but documentation incomplete** → `NEED_MORE_INFO` (a paperwork problem, not a clinical one)
   - **(c) Not medically necessary under the supplied policy** → `LIKELY_DENY`
   Confusing (b) with (c) is the single most important failure mode to avoid — denying a valid case because a note is missing, or approving because the model filled the gap itself.
3. **Judge against the supplied payer policy excerpt only**, not general medical knowledge. If the policy is silent on something, say so.
4. **Per-criterion verdicts:** each policy criterion is marked `MET`, `PARTIALLY_MET`, `UNMET`, or `NOT_ASSESSABLE` (insufficient documentation), each with evidence.
5. **Handle contradictions explicitly** (e.g. two notes disagree on a date, dose, or severity) — surface them, don't silently pick one.
6. **Calibrated confidence** — the confidence must reflect documentation completeness and conflicts, with a stated reason.
7. **Actionable provider queries** — specific questions naming exactly what document/value is needed and which criterion it would satisfy (not "please send more records").
8. **Appeal direction** — for deny or pend outcomes, what argument/evidence would most likely change the decision.
9. **Optional workflow state** — `PEND_FOR_CLINICALS` can be used to separate "we're waiting on documents" (workflow) from the medical-necessity opinion itself.

---

## 7. Output contract (target schema)

Fields required by the workbook; exact types are an initial proposal and can be refined after inspecting the data.

```jsonc
{
  "case_id": "string",
  "requested_service": {
    "description": "string",            // procedure / test / admission requested
    "codes": ["string"],                // CPT/ICD etc. if present in packet
    "site_of_care": "string"            // inpatient / outpatient / etc., if stated
  },
  "clinical_summary": "string",         // concise, factual, no inference beyond packet
  "criteria_assessment": [
    {
      "criterion_id": "string",
      "criterion_text": "string",       // from payer policy excerpt
      "status": "MET | PARTIALLY_MET | UNMET | NOT_ASSESSABLE",
      "reasoning": "string",
      "evidence": [{ "source_doc": "string", "snippet": "string" }]
    }
  ],
  "supporting_factors": ["string"],     // what strengthens the case
  "weakening_factors": ["string"],      // what weakens the case
  "contradictions": [{ "issue": "string", "sources": ["string"] }],
  "missing_information": [{ "item": "string", "affects_criterion": "string", "why_it_matters": "string" }],
  "necessity_category": "SUPPORTED_DOCUMENTED | PLAUSIBLE_INCOMPLETE | NOT_NECESSARY_UNDER_POLICY",
  "recommendation": "LIKELY_APPROVE | NEED_MORE_INFO | LIKELY_DENY",
  "workflow_state": "PEND_FOR_CLINICALS | READY_FOR_DECISION",   // optional
  "confidence": { "level": "HIGH | MEDIUM | LOW", "score": 0.0, "rationale": "string" },
  "provider_queries": ["string"],
  "appeal_direction": "string"
}
```

---

## 8. Evaluation criteria (what the output will be scored on)

| Criterion | What "good" looks like |
|---|---|
| Extraction accuracy | Facts pulled correctly from notes, labs, meds, imaging, etc., with correct values and dates. |
| Guideline matching | Each policy criterion correctly mapped to MET / PARTIALLY_MET / UNMET. |
| Uncertainty handling | Low confidence where documentation is thin or conflicting; never overconfident on gaps. |
| Evidence traceability | Every claim links back to a quoted source snippet. |
| Actionability of provider queries | Specific, targeted questions tied to a criterion. |
| Gap vs. true non-necessity | Correctly separates `NEED_MORE_INFO` from `LIKELY_DENY`. |

Plan to build a small **eval harness** that runs the skill over the labeled training cases and reports label accuracy, a confusion matrix (especially APPROVE/MORE_INFO/DENY confusion), and per-case error analysis.

---

## 9. Open decisions (to settle after inspecting the workbook)

- Tech stack for the pipeline and API (language, framework, LLM provider/model).
- Pipeline shape: single prompt vs. multi-stage (e.g. normalize → extract facts → parse policy into criteria → match → decide → generate queries/appeal), and where deterministic rules sit vs. LLM judgment.
- How "learning from denial trends" is materialized: derived rules/checklists, few-shot exemplars, retrieval over past cases, or a combination.
- Input format the API accepts (raw text documents, JSON packet, uploaded workbook rows).
- Whether to use `PEND_FOR_CLINICALS` as a separate workflow state.

---

## 10. Suggested first steps for Claude Code

1. Put the workbook in `data/` and inventory every sheet → `docs/data_inventory.md`.
2. Read all training cases and write a short pattern analysis: what drove each approve / deny / gap outcome → `docs/denial_patterns.md`.
3. Draft the fact schema from the "data aspects" sheet and the output schema above.
4. Propose the pipeline design and stack, and confirm with me before building.
