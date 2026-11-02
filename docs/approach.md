# PolicyLens — approach (short note)

This note explains how PolicyLens implements the pre-authorization copilot the assignment describes: read a messy packet and payer policy, extract auditable facts, match policy criteria, and return a recommendation a human reviewer can defend.

## What the copilot does

PolicyLens performs a **first-pass utilization review**, not a coverage decision.

It ingests heterogeneous documents (notes, labs, imaging reports, meds, request forms) plus an optional **payer policy excerpt**. It:

1. Normalizes the packet (document IDs, types, dates).
2. Extracts clinically relevant **facts** on a fixed 30-aspect checklist (and any **policy measurements** the policy names, e.g. BMI or test thresholds).
3. **Verifies** that every quoted fact appears verbatim in its cited document; unverified quotes are dropped and facts without proof are treated as missing.
4. Splits the policy into atomic **criteria** and, for each one, records evidence → reasoning → status: **MET**, **PARTIALLY_MET**, **UNMET**, or **NOT_ASSESSABLE**.
5. Applies **deterministic decision rules** (no LLM) to map criterion statuses to exactly one of **LIKELY_APPROVE**, **NEED_MORE_INFO**, or **LIKELY_DENY**, plus necessity category, workflow state, and **calibrated confidence**.
6. Drafts **provider questions** (one per documentation gap) and **appeal direction** when useful.

Every factual claim in the output is intended to trace to a **source document and snippet**. Internal IDs (`D#`, `F#`, `C#`) in JSON support audit; the UI and print report use plain document names for readability.

## Pipeline (aligned to the assignment flow)

| Assignment stage | PolicyLens implementation |
|------------------|---------------------------|
| 1. Ingest | Code: validate request, assign `D1…Dn` |
| 2. Policy → checklist | LLM assess: split policy into `C1…Cn` (+ final “prerequisites missing” criterion when applicable) |
| 3. Extract | LLM extract: fact sheet `F1…F30` (+ extra facts for policy measurements), each with verbatim quotes |
| 4. Reconcile | Skill rules + output: **contradictions**, **source hierarchy**, conflicts on request identity |
| 5. Match | LLM assess: per-criterion status with evidence |
| 6. Decide | **Code only** (`internal/decide`): fixed rule order → one of three outcomes |
| 7. Explain | LLM queries + appeal; supporting/weakening factors; code-written **bottom line** |
| 8. Verify | Code after extract (quote-in-source) and after assess (guardrails, e.g. gap ≠ UNMET) |

**Design choice:** the model **labels** criteria; **code decides** the verdict. That makes the hardest assignment requirement enforceable: separating **missing paperwork** from **not medically necessary under the policy**.

## How evidence is weighed

The skill encodes three weights (in `skill/SKILL.md`, §Source hierarchy):

1. **Type** — Objective tests (imaging, labs, EMG, etc.) outweigh narrative alone; specific findings outweigh vague wording (“grip 4/5” beats “strength grossly intact”).
2. **Recency** — When dates conflict, a recent specialist exam tends to outweigh an older or generalist note (after recording the conflict).
3. **Source** — A document that directly addresses the requested service outweighs one that does not.

**Emotional or strong language is not treated as evidence.** Pain severity alone does not substitute for policy-required findings (learned from training pattern PA-002).

When documents **disagree**, the skill must:

- Record the conflict in `contradictions` (issue, sources, **preferred source**, why).
- Apply the hierarchy where it resolves the conflict; otherwise downgrade certainty (e.g. PARTIALLY_MET / lower confidence), **never silently pick one version** for the final criterion without saying so.

Quote verification adds a hard floor: if a quote cannot be found in the document, it is removed; the fact cannot support MET/UNMET without a verified quote.

## Missing information: paperwork vs medical

The skill must answer for every gap: **documentation problem** or **case does not meet policy**?

| Situation | Typical criterion status | Recommendation direction |
|-----------|-------------------------|---------------------------|
| Clinically plausible, but a required fact is **not documented** in the expected place (e.g. ADL impact only in PT note, not surgeon note) | PARTIALLY_MET or NOT_ASSESSABLE on that criterion | **NEED_MORE_INFO** — ask for a **specific** document or statement |
| Packet **documents absence** or failure vs policy (e.g. test below threshold, required finding absent after work-up) | UNMET (with cited facts) | **LIKELY_DENY** — not fixed by “send more records” alone |
| Nothing in the packet bears on a criterion | NOT_ASSESSABLE | Contributes to **NEED_MORE_INFO** when core criteria are otherwise OK |

**Non-negotiable rules (prompt + code guardrails):**

- **Never invent facts.** Undocumented = **MISSING**, not assumed.
- A statement that something is **“not documented”** or **missing from the chart** is a **paperwork gap** → at most PARTIALLY_MET / NOT_ASSESSABLE, **never UNMET**.
- **UNMET** requires documented clinical negativity or measured failure against policy wording.
- Confusing “need more info” with “deny” is the primary failure mode the guardrails target.

Provider queries are **one question per gap**, naming the exact artifact needed and which criterion it would satisfy (not “please send more records”).

## How the recommendation is framed

Exactly **one** of:

| Outcome | Meaning |
|---------|---------|
| **LIKELY_APPROVE** | Supported and documented under the supplied policy (`SUPPORTED_DOCUMENTED`). |
| **NEED_MORE_INFO** | Plausible under the policy, but documentation incomplete (`PLAUSIBLE_INCOMPLETE`); workflow may be `PEND_FOR_CLINICALS`. **Not a rejection.** |
| **LIKELY_DENY** | Policy requirements not met with documented evidence (`NOT_NECESSARY_UNDER_POLICY`). |

Each run includes:

- **Criteria assessment** — each requirement with status, reasoning, and **evidence snippets** (quote + source).
- **Clinical summary** — factual, packet-bound.
- **Supporting / weakening factors**, **missing_information**, **contradictions**.
- **Confidence** — numeric score and rationale from code (penalties for partial/not assessable, contradictions, dropped quotes, missing policy).
- **Provider queries** — targeted, criterion-linked (when gaps remain).
- **Appeal direction** — strongest MET evidence first, then what would flip the verdict; for deny, what clinical finding would need to exist (without inventing it).

Judgment is **only against the supplied policy**. If no policy is sent, the skill uses learned pattern types and caps confidence; bundled training fixtures in the repo are thin, no-policy scenarios.

## What we built to test it

- **Skill:** `skill/SKILL.md` (versioned), schemas, few-shot examples from workbook training cases.
- **API:** `POST /v1/assess` with documents + policy; full trace via `GET /v1/traces/{id}` or `?include_trace=true`.
- **Demo UI:** stage-by-stage trace, quote highlighting, print/PDF report, JSON download.

The assignment **complex case** (full multi-document packet and gold labels) is **not stored in this repository**; run it locally via the API with your workbook copy. See [deliverable.md](deliverable.md) and [design.md](design.md) for technical detail, eval, and production notes.
