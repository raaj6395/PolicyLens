# Denial / Approval Patterns from the Training Cases

What drove each outcome, and the reusable rule it teaches. These rules are copied into `skill/SKILL.md` §5 tagged with their case ID so they can be withheld during leave-one-out evaluation.

| Case | Service | Outcome | Driver | Rule learned |
|---|---|---|---|---|
| PA-001 | Cervical decompression/fusion (inpatient) | NEED_MORE_INFO | Strong objective necessity (MRI cord compression, myelopathy signs, failed care) but latest consult lacks ADL statement and inpatient justification | Strong clinical need + paperwork gap = pend, never deny. Functional loss found only in a PT note is partial evidence. |
| PA-002 | Lumbar fusion for chronic LBP | LIKELY_DENY | No instability, no deficit; only pain and degenerative MRI | Pain language and non-specific degeneration do not establish necessity. Documented absence of the qualifying finding is UNMET, not missing. |
| PA-003 | Total knee arthroplasty | LIKELY_APPROVE | Severe OA on X-ray, failed NSAIDs/injection/PT, functional decline | Imaging + severity + failed conservative care aligned = approve. A risk factor (BMI) is not an exclusion unless the policy says so. |
| PA-004 | Nocturnal home oxygen | LIKELY_DENY | Symptoms only; no qualifying oximetry or sleep study | Threshold criteria need the test value. Symptoms do not substitute for a required measurement. |
| PA-005 | UC biologic | NEED_MORE_INFO | Severe refractory disease, but TB/hepatitis screening pending | Clinical need + pending safety prerequisite = pend. |
| PA-006 | PET/CT thyroid surveillance | LIKELY_DENY | Asymptomatic low-risk surveillance, no rising markers or suspicious imaging | High-cost imaging without a trigger is overuse. Absence of an indication is a deny, not a gap. |
| PA-007 | IVIG for CIDP | LIKELY_APPROVE | EMG/NCS, progressive weakness, steroid intolerance; one vague note doubts diagnosis | Objective studies outrank a vague narrative note. Record the conflict, do not let it override. |
| PA-008 | IRF after stroke | LIKELY_APPROVE | Two disciplines, 3 h/day tolerance, unsafe for home | Post-acute site of care is judged on intensity, ability to participate and safety. Minor inconsistent detail (aphasia) does not change it. |
| PA-009 | Bariatric surgery | NEED_MORE_INFO | BMI >40 with comorbidities, program and psych done; nicotine cessation date unclear | Program prerequisites are core: an unclear prerequisite pends even when clinical need is strong. |
| PA-010 | TAVR | LIKELY_APPROVE | Severe symptomatic AS, heart team evaluation, frailty; coronary anatomy summary missing | A minor packet gap does not overturn a complete high-acuity specialist assessment. |

## Cross-cutting themes

1. **Gap vs. non-necessity.** Pends (001, 005, 009) all have strong clinical need and a fixable document or prerequisite. Denials (002, 004, 006) all lack the *clinical* trigger itself; more paperwork of the same kind would not help.
2. **Objective over narrative.** Imaging, EMG, echo and oximetry decide criteria (003, 004, 007, 010). Narrative pain or symptoms alone never do (002, 004).
3. **Prerequisites are blocking, packet trivia is not.** Safety screening and program requirements pend the case (005, 009). A missing summary when the specialist work-up is complete does not (010).
4. **Conflicts lower confidence, not verdicts.** 001, 007 and 008 all have contradictory notes; the outcome follows the stronger, more recent, objective source.
