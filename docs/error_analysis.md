# Error Analysis

Model: `gpt-oss:120b-cloud` via Ollama, temperature 0. Final skill version: **1.7.0**. Raw numbers: [eval_results_loo.md](eval_results_loo.md), [eval_results_insample.md](eval_results_insample.md). Every trace referenced here can be opened in the demo (Eval tab → Open trace).

## Final results (skill 1.7.0)

| Mode | Label accuracy | MORE_INFO ↔ DENY confusions | Complex case | Complex C1–C6 vs workbook |
|---|---|---|---|---|
| Leave-one-out | **9/11 (82%)** | 1 | NEED_MORE_INFO ✅ | 4/6 (C4 MET, C6 NOT_ASSESSABLE) |
| In-sample | **9/11 (82%)** | 0 | NEED_MORE_INFO ✅ | **6/6** |

The complex case runs with the same exclusions in both modes (PA-001 withheld), so its two rows are two samples of the same configuration. The difference between them is run-to-run variance (see E4).

## How the skill got here

Each row is a full eval run. Every fix is generic; none hard-codes a case label.

| Version | LOO | What the run exposed | Fix applied |
|---|---|---|---|
| 1.0.0 | complex only: **LIKELY_DENY** ❌ | C5/C6 marked UNMET because the chart review says "surgeon note does not explicitly state… why ASC/outpatient is unsafe". The model treated a missing note as proof of non-necessity, the exact failure the assignment warns about. Two quotes used `...` and were dropped. | SKILL: documentation-gap rule (a gap is never UNMET), no ellipses in quotes. Code: an UNMET resting only on a Missing-records fact is downgraded. |
| 1.1–1.2 | complex: NEED_MORE_INFO, 5/6 | The model invented criteria the policy never states (C6–C8: contraindications, clearances); C4 MET although the surgeon note lacks ADL impact. | SKILL: exactly one criterion per policy requirement; requesting-provider rule; explicit rules for the final prerequisites criterion. |
| 1.3.0 | 5/11 (45%) | Training cases (no policy) pended almost everything: the no-policy fallback derived 6–9 speculative criteria that came back NOT_ASSESSABLE. Generic rules also quoted phrases from specific cases ("no rising tumor markers"), leaking them into leave-one-out. | SKILL: no-policy fallback picks 3–5 criteria that fit the service; generic sections rewritten without case phrases. Added in-sample mode. |
| 1.4.0 | 8/11 (73%) | Complex C4 still flips to MET in about 2 of 3 runs: the model saw the reported gap and ignored it. | Assess prompt lists packet-reported gaps; the model *links* each gap to a criterion; code makes a criterion that cites its own reported gap at most PARTIALLY_MET. |
| 1.6.0 | 6/11 (55%) | Complex case 6/6, but **PA-004 and PA-006 regressed to NEED_MORE_INFO**: clinical negatives in the UR note ("no rising markers", "sats do not meet threshold") had been filed under Missing records and were now treated as paperwork gaps. Invented "no contraindications" criteria still blocked PA-007/PA-008. | SKILL: distinguish by subject (a statement about the patient is a documented negative; a statement about the paperwork is a gap); Missing records holds only document gaps. Code: with no policy, a core NOT_ASSESSABLE criterion with no evidence becomes non-core. |
| **1.7.0** | **9/11 (82%)** | See remaining errors below. | — |

Lesson from 1.6.0: a fix that perfected the showcase case broke two training cases. Without the regression eval, that would have shipped. This is why `production.md` makes the eval a release gate.

## Remaining errors

### E1. PA-010 TAVR: expected LIKELY_APPROVE, got NEED_MORE_INFO (both modes)
- **What the skill said:** C4 "Required prerequisite: coronary anatomy summary present", PARTIALLY_MET and core. The missing summary was read as a TAVR prerequisite, so the case pended.
- **Expected:** "Packet gap should not overturn if heart-team assessment is complete."
- **Root cause:** criterion judgment, specifically the `core` flag. With no policy text, the model cannot know whether the payer treats the coronary summary as a prerequisite. It errs toward pend, even in-sample where the PA-010 pattern is present.
- **Assessment:** this is the safe direction of error (pend, not deny). With a real policy that lists TAVR prerequisites, the core flag would be decidable. Open item: let pre-split policies declare which items are prerequisites, so the model doesn't guess.

### E2. PA-004 home oxygen, leave-one-out: expected LIKELY_DENY, got NEED_MORE_INFO
- **What the skill said:** "No resting/ambulatory sats that meet threshold; nocturnal desaturation study absent" was read as *the data is missing* (PARTIALLY_MET) rather than *the measured values do not qualify* (UNMET).
- **Root cause:** a missing pattern plus ambiguous source wording. The sentence supports both readings, and only the withheld PA-004 pattern resolves it ("symptoms without qualifying test values do not meet threshold criteria"). In-sample, the skill gets it right (C1 UNMET → LIKELY_DENY).
- **Assessment:** this is the one MORE_INFO ↔ DENY confusion. It is in the conservative direction, and it is the expected cost of leave-one-out on a case whose lesson exists nowhere else. Real packets would carry the actual SpO2 values, which removes the ambiguity.

### E3. PA-007 IVIG for CIDP, in-sample: expected LIKELY_APPROVE, got LIKELY_DENY
- **What the skill said:** it invented the criterion "Diagnosis certainty documented without conflicting statements" and marked it UNMET, citing "One note questions diagnosis certainty".
- **Root cause:** two things together. The model invented a criterion, and it ignored the source hierarchy (EMG/NCS outranks a vague note). The same case passed leave-one-out, so this is variance, not a systematic gap.
- **Assessment:** this is the most serious remaining error type (an approvable case called a denial), although its confidence was LOW (0.39) and a reviewer would see the conflict in the trace. Suggested fix: a code guardrail so that a criterion cannot be UNMET when its only evidence is the losing side of a recorded contradiction. This is not implemented yet.

### E4. Complex case: criterion-level variance
- **Every complex-case run from skill 1.1 onward (more than ten) returned NEED_MORE_INFO.** Confidence was MEDIUM each time; recorded scores range 0.55–0.73.
- **C4 (functional impairment):** about one run in three still says MET. ADL loss *is* documented, just in the PT note, so this is a borderline judgment.
- **The policy split itself varies.** One run produced C6 "screenings and clearances" plus C7 "no prerequisites missing" instead of a single C6, which shifts the positional comparison.
- **Fix:** split each payer policy once per version, have a human check the split, and pass fixed criterion IDs in (`production.md` §3). This removes the split variance entirely, and C4 would then be judged against a stable criterion text.

## What the numbers do and don't mean

- 11 cases is a small set. One case flipping moves accuracy by 9 points, and two runs of the same version can differ. Treat these as regression signals, not production estimates.
- The training packets are three-sentence synthetic summaries with no policy. Confidence is LOW on all of them by design (no-policy cap), and that is the honest calibration.
- Across all 1.7.0 runs, no NEED_MORE_INFO case was ever denied. The confusions that remain are approve → pend (E1), deny → pend (E2), and one approve → deny at LOW confidence (E3).

## New authored cases (SYN-001 … SYN-010)

Ten cases written after the skill was built, each with its own synthetic payer policy and 3–6 documents. They include deliberate traps: contradictory vitals, pain-heavy language with no red flags, complete paperwork that still fails clinically, and a qualifying test hidden next to a non-qualifying one. **The expected labels are the author's judgment, not workbook ground truth.** Run on OpenAI `gpt-4.1`: [eval_results_synthetic.md](eval_results_synthetic.md).

| Version | Result | Finding |
|---|---|---|
| 1.7.0 | 8/10, 0 more-info ↔ deny | SYN-004 (cellulitis admission) and SYN-006 (home oxygen) missed. In both, the AI judged every criterion correctly: in SYN-006 it even recognized that the "95%" reading was taken *on* oxygen. The **decision rules** were wrong: they assumed every criterion is required, but these policies say "ANY of the following". SYN-006 has resting SpO2 91% (UNMET) and exertional SpO2 85% (MET), yet the case was **denied**. |
| 1.8.0 | **10/10**, 0 more-info ↔ deny | Fix: the assessment schema gained `any_of_group`. The skill tells the model to label alternatives, and `decide.collapse` treats a group as MET when any member is MET. The new table-driven tests cover one alternative met (approve), all unmet (deny), and the best alternative partial (pend). |

| 1.9.0 | **10/10**, 0 more-info ↔ deny | Regression run after the policy-measurement fix below. No case changed label. |
| 1.10.0 | **10/10**, 0 more-info ↔ deny | Regression run after the asthma-case fixes below. No case changed label. |

Lesson: the workbook cases never exercised OR-logic policies, so a structural gap stayed invisible until new cases were tried. That is the argument for a growing, versioned regression set.

Caveat: the workbook eval results above were produced on skill 1.7.0 with `gpt-oss:120b-cloud`. Rerun `make eval && make eval-insample` on the current skill with `gpt-4.1` before comparing across models.

## Ad-hoc case: sleeve gastrectomy (skill 1.8.0 → 1.9.0)

A bariatric packet entered through the UI. The policy requires BMI ≥40, or ≥35 with a comorbidity. The consult note states "BMI 41.2".

- **1.8.0 got the right label (NEED_MORE_INFO, psych clearance pending) for a partly wrong reason.** It marked the BMI criterion PARTIALLY_MET with "BMI value is not explicitly stated", and it asked the provider for a BMI that was already in the packet.
- **Root cause: extraction.** The 30-aspect checklist (from the workbook's data-aspects sheet) has no slot for body measurements, and extraction never saw the policy. So "BMI 41.2" was read and dropped. The assessment may only reason over extracted facts, so it correctly reported the value as absent. No guardrail caught it, because every guardrail checks what is *cited*, not what was *left out*.
- **Fix (1.9.0).** Extraction now receives the policy. It is used only to learn which numeric thresholds matter, and is never quoted. Any such value without an aspect becomes an extra fact (category "Policy measurement"). The rule is limited to numeric measurements. A first wording ("every value the policy sets a threshold or count on") made the model copy every policy requirement into extra facts. One of those restated a missing-record note under a different aspect, which would have let a criterion bypass the gap guardrail. Readings from different dates are recorded as a trend, not a CONFLICT.
- **After:** BMI extracted from both notes with dates (41.2 and 38.9), C2 MET, and only the psych-clearance query remains. The complex case on 1.9.0 matched the workbook on all six criteria (C1–C3 MET, C4–C6 PARTIALLY_MET).

Lesson: the fixed aspect list is a coverage ceiling. Anything a policy hinges on that the list doesn't name used to vanish silently.

## Ad-hoc case: dupilumab for severe asthma (skill 1.9.0 → 1.10.0)

`examples/asthma_biologic_request.json` has 8 documents, and a utilization-review note recommends denial for three wrong reasons: the latest eosinophil count of 120 was drawn on prednisone; "current smoker" comes from an ED triage template, while the cotinine test is negative and the pulmonologist says the patient quit in 2019; and the prior omalizumab was stopped. The author's expected label is **LIKELY_APPROVE**.

**On 1.9.0 the result was NEED_MORE_INFO.** The model never accepted the UR note's claims, so the system never moved toward a denial. It still pended for these reasons:

| Defect | Where | Fix (1.10.0) |
|---|---|---|
| C5 "not a current smoker" PARTIALLY_MET although the model named the cotinine test as the trusted source | assess | SKILL resolved-conflict rule: judge on the preferred source; code already lowers confidence for the conflict |
| C1 eosinophils PARTIALLY_MET because "FeNO: not performed" was filed under Missing records | extract + assess | "Not performed" is clinical workup, not a missing record. A gap in an unused alternative never counts against the alternative that is met |
| The model restated every policy requirement as an extra fact, so the smoking conflict appeared in two facts | extract | Policy measurements cover patient attributes only. **Code** drops any policy measurement whose quotes another fact already holds (`validate.Facts`, unit-tested). This also closes a route around the gap guardrail |
| A provider query about "site of care" for a self-injected drug | queries | **Code**: with a policy supplied, only policy criteria generate queries (`queries.Gaps`) |
| One run cited the blank signature date on all 8 criteria | assess | A form gap concerns only the final prerequisites criterion, never a clinical one |

**After the fixes, 3 identical runs gave 1 LIKELY_APPROVE and 2 NEED_MORE_INFO.** In each pended run one criterion stayed PARTIALLY_MET: C5 in one run, C1 in the other. The model still sometimes ignores the resolved-conflict rule or files an unperformed test as a gap. Every run had all other clinical criteria MET, and none went near a denial.

**Assessment:** the remaining error is in the safe direction (pend, not deny), and it shows up as varying output, not a confident wrong answer. Prompt rules have reached their limit here. Next steps, which are not built:
- (a) **Self-consistency:** run the assessment 3 times and take the majority status per criterion. This needs fixed criterion IDs, which come from pre-split policies (`production.md`).
- (b) **Structured status reasons:** a required `limited_by` field (`documentation_gap`, `unresolved_conflict`, `incomplete_evidence`) on every PARTIALLY_MET, so code can check the claim against the recorded contradictions.

The bariatric and complex cases did not change across these versions (complex: C1–C3 MET, C4–C6 PARTIALLY_MET, matching the workbook).


## Ad-hoc case: IRF admission after stroke (skill 1.10.0)

`examples/irf_stroke_request.json` looks approvable: an outdated physiatry screen says "able to tolerate 3 hours", and a case manager letter pushes for approval. The newest documents show the patient is not tolerating the program (30–45 minutes per day) and is not medically stable (IV antibiotics, oxygen). The author's expected label is **LIKELY_DENY**.

- **Two runs, both LIKELY_DENY** through `core_unmet`: C3 (tolerance) and C4 (stability) UNMET, resolved in favour of the newer addendum and PT log. The paperwork gaps (OT evaluation, discharge summary) did not soften the verdict into a pend.
- **Defect fixed:** `missing_information` listed "current ability to tolerate 3 hours" and "medical stability documentation". Those are documented clinical failures, not missing paperwork, and listing them blurred the very distinction the output exists to make. `queries` now leaves UNMET criteria out of the gaps. The prompt gives them in a separate "documented as not met" section, to be addressed only in the appeal direction. After the fix, `missing_information` held only the OT evaluation and the discharge summary.
- **Variance in C6** (screen within 48 hours): one run counted the 10/19 physiatry re-evaluation and marked it MET; the other counted only the 10/14 screen and marked it UNMET. The label is unaffected.
- **Missed contradictions:** neither run flagged NKDA (H&P) vs penicillin allergy (10/16 note) while ampicillin-sulbactam was being given, or the stroke onset of 10/12 vs 10/11. Extraction recorded only one side of each (F19, F9). Neither conflict touches a policy criterion. Even so, the hard rule "record both sources" was silently missed, and that rule is enforced only by the prompt today.

## Complex eval set CT-01…CT-04 (skill 1.10.0 → 1.12.0)

Four cases in `examples/eval_cases/` (answer key: `ANSWER_KEY.md`), added to the regression set as SYN-011…SYN-014 along with the bariatric, asthma and IRF cases (SYN-015…017).

- **First run by the user (1.10.0): 1/4.** CT-01 NEED_MORE_INFO (expected deny), CT-02 NEED_MORE_INFO (expected approve), CT-03 LIKELY_DENY (expected pend), CT-04 approve ✅.
- **1.11.0, prompt rules only** (failed-condition rule, request-identity rule): 17-case regression **13/17**, 2 more-info ↔ deny. The model quoted the evidence and then ignored both rules. One run **crashed**: the model labelled the alternatives of an "EITHER … OR" requirement `C2a`/`C2b`, the schema rejected them twice, and the request failed.
- **1.12.0:**
  - The criterion ID pattern accepts `C2a`, because a natural label must not fail a review.
  - **New structured field `request_conflict`** with a code guardrail: while the documents disagree about *what* is requested, no criterion may be UNMET, so no denial is possible. Via the API, CT-03 then gave NEED_MORE_INFO in 2 of 2 runs (once from the model, once enforced by the guardrail).
- **Still open:**
  - **CT-01:** in all 5 runs the model wrote "nicotine patch" in its reasoning and still marked the abstinence criterion PARTIALLY_MET, because the cotinine test was pending. This is a pend instead of a deny, the safe direction. A structural fix (per-condition statuses inside a criterion, combined by code) is designed but not built.
  - **CT-02 and asthma:** each approved in 1 of 2 runs. One CGM pend came from the model misusing `request_conflict` for a medication contradiction. The wording now restricts it to the identity of the requested item; this is untested.
- **Testing stopped:** the OpenAI account ran out of credits mid-run (HTTP 429). `data/eval/report_synthetic.json` still holds the 1.11.0 result (13/17). Rerun `go run ./cmd/eval -mode synthetic` once credits are added.
