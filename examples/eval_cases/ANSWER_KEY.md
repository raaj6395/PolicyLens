# Complex eval cases: answer key

The expected labels are the author's judgment under the supplied synthetic policy. They are not workbook ground truth. Each case targets one failure mode the earlier cases did not exercise.

| Case | Expected | What it tests |
|---|---|---|
| CT-01 lumbar fusion | **LIKELY_DENY** | A clinical negative hidden in a nursing note, alongside a pending test that invites a pend |
| CT-02 CGM | **LIKELY_APPROVE** | A UR screen recommending denial, built on outdated and wrong facts |
| CT-03 hip arthroplasty | **NEED_MORE_INFO** | The request form names the wrong side; the conflict cannot be resolved by picking a source |
| CT-04 lumbar MRI (fax) | **LIKELY_APPROVE** | One messy OCR document, an ANY-of policy with five alternatives, and four of them documented negative |
| CT-05 primary-prevention ICD | **LIKELY_DENY** | Every document type; date arithmetic across documents; the request form and UR note both miss a later procedure |

## CT-01: L4-L5 fusion → LIKELY_DENY

| # | Criterion | Expected | Key evidence / trap |
|---|---|---|---|
| 1 | Grade ≥2 **or** ≥3 mm dynamic translation | MET (via translation) | Flexion-extension: "5 mm of dynamic translation". **Trap:** the MRI's "No evidence of instability on this static study" is about a static test and must not be read as UNMET. Grade 1 alone fails the other alternative, which is fine. |
| 2 | Claudication/radiculopathy plus corresponding compression | MET | Walking limited to one block, relieved by sitting; MRI shows "compressing the traversing L5 nerve roots" |
| 3 | ≥6 months conservative care incl. PT | MET | PT Feb–Apr, home exercise program, gabapentin, naproxen, ESIs in March and July; 14 months of symptoms |
| 4 | Nicotine abstinence ≥6 weeks **including replacement products**, cotinine negative | **UNMET** | Nursing intake: "Currently using nicotine patch 14 mg daily". That is documented nicotine use, a fact about the patient and not a paperwork gap. **Trap:** "cotinine… result pending" invites a NEED_MORE_INFO, but a patch would make cotinine positive anyway. **Trap:** "Current smoker" on 2026-06-20 is an older reading in a trend, not a contradiction. |
| 5 | BMI <40 | MET | BMI 38.7 (2026-10-08) is the latest; 40.6 (2026-06-20) is older. Recorded as a trend, not CONFLICT. |

- **Rule fired:** `core_unmet`.
- **Appeal direction:** stop the patch, wait 6 weeks with no nicotine at all, get a negative cotinine, then resubmit.
- **Failure modes:**
  - NEED_MORE_INFO: missed the patch and pended on the pending cotinine.
  - Deny for the wrong reason: C1 UNMET from the static MRI.

## CT-02: CGM → LIKELY_APPROVE

| # | Criterion | Expected | Key evidence / trap |
|---|---|---|---|
| 1 | Diabetes | MET | E11.65 |
| 2a | MDI ≥3/day **or** pump | MET | "4 injections daily in total" (endocrinology 07-18), plus lispro fills monthly from June to October |
| 2b | **or** problematic hypoglycemia | UNMET or not needed | "Denies any glucose below 54". This alternative isn't needed and must not count against the request. |
| 3 | **In-person** visit within 6 months | MET | 2026-07-18 is an in-person visit, 3 months before the order. **Trap:** the most recent visit (09-12) was telehealth. That doesn't matter, because an in-person visit is also in the window. |
| 4 | Training | MET | Educator note 10-20 |
| — | Prerequisites / packet | PARTIALLY_MET, non-core | Sensor quantity "[not specified]" is a form gap only |

- **Contradiction:** "basal insulin only" in the 04-02 med list and the UR screen vs basal-bolus in the 07-18 note and the pharmacy fills. Trust the newer specialist note and the objective fill record.
- **Rule fired:** `core_met_admin_gap` (or `all_met`).
- **Failure modes:**
  - Deny: believed the UR screen.
  - Pend: made the telehealth visit or the hypoglycemia alternative count against the request.

## CT-03: Total hip arthroplasty → NEED_MORE_INFO

| # | Criterion | Expected | Key evidence / trap |
|---|---|---|---|
| 1 | Advanced arthritis **of the hip to be replaced** | PARTIALLY_MET or NOT_ASSESSABLE | The request form says **LEFT** (M16.12), but the same surgeon's consult plans a **right** THA. The X-ray shows right KL 4 and left KL 1. The source hierarchy cannot settle which hip is requested, so this must stay open with a contradiction recorded. |
| 2 | Pain/function ≥3 months affecting ADLs | MET (for the right hip) | 18 months; cannot put on her own shoes and socks |
| 3 | ≥3 months nonsurgical, ≥2 modalities | MET | PT, acetaminophen/naproxen, injection, cane |
| 4 | HbA1c <8.0% within 90 days of surgery | MET | 7.6% on 09-28 is 45 days before 11-12. The 8.4% on 05-14 is older, a trend reading. |
| 5 | No active infection | MET | E. coli UTI was treated; the 10-10 culture showed no growth |

- **Provider query:** confirm the operative side and correct the request form or diagnosis code. If it's the right hip, every criterion is met.
- **Failure modes:**
  - Deny: judged the left hip literally (KL 1 → UNMET), treating a clerical conflict as a clinical failure.
  - Approve: silently picked the right hip, which breaks hard rule 4 ("never silently pick one").

## CT-04: Lumbar MRI from a fax → LIKELY_APPROVE

| Alternative | Expected | Evidence |
|---|---|---|
| (1) Cauda equina | UNMET | "Denies saddle numbness, denies urinary retention or incontinence" |
| (2) Cancer history plus new back pain | **MET** | "L breast ca 2019 s/p mastectomy + chemo, on tamoxifen since 2020" plus "low back pain x 3 wks, worse at night" |
| (3) Infection | UNMET | "Denies fever", "No IVDU", "No recent spine procedures" |
| (4) Motor deficit | UNMET | "Strengh 5/5 bilat LE" (sic: an OCR typo, so the quote must still verify) |
| (5) ≥6 weeks conservative therapy | UNMET | Only 3 weeks |

- **Rule fired:** `all_met`, after collapsing the any-of group. Any alternative that is MET satisfies the group; the four unmet ones must not pull the verdict down.
- **Contradiction:** onset "no trauma recalled" (10/24) vs "Lifted heavy box at work 9/30" (urgent care). Record it; it doesn't change alternative 2.
- **Trap:** the urgent-care note says "Mechanical strain suspected. No red flags documented". It was written before the cancer history was considered and must not override the newer assessment.
- **Failure modes:**
  - Deny: one of the documented negatives was not grouped as an alternative, or the urgent-care note won.
  - Pend: the model asked for 6 weeks of conservative care.
  - Dropped quotes: the model "fixed" OCR text inside a quote.

## CT-05: Primary-prevention ICD → LIKELY_DENY

Fifteen documents: request form, H&P, two cath reports, two echos, discharge summary, cardiology progress note, lab trend, pharmacy medication history, allergy list, prior procedures list, PCP note, EP consult and UR pre-review. The request date is 2026-10-28.

| # | Criterion | Expected | Key evidence / trap |
|---|---|---|---|
| 1 | Ischemic cardiomyopathy, LVEF ≤35% | MET | Echo 2026-10-14: "LVEF 33%". The 25% on 2026-06-12 is an earlier reading in a trend, not a conflict. |
| 2 | NYHA II or III | MET | EP 2026-10-22: "NYHA class II: short of breath after one flight of stairs". **Contradiction:** the PCP note on 2026-09-18 says "walking 2 miles daily without… shortness of breath". The more recent specialist note is trusted. |
| 3 | ≥40 days since MI **and** ≥90 days since the most recent revascularization | **UNMET** | MI on 2026-06-10 is 140 days back, which passes. **But a staged RCA PCI on 2026-08-25** (cath report and prior-procedures list) is only **64 days** before the request, which fails. **Traps:** the request form says "No further revascularization", the EP consult mentions only the LAD PCI, and the UR note repeats the request form. The discharge summary had already planned a "staged RCA PCI". |
| 4 | ≥3 months GDMT at tolerated doses, intolerance documented | MET | Metoprolol from 06-12, sacubitril/valsartan from 06-13 (fills through October), dapagliflozin from 07-02; spironolactone stopped for K 5.9, which is documented in the lab trend, pharmacy record and allergy list |
| 5 | Survival >1 year with good function | MET | EP: "expected survival well beyond 1 year" |
| 6 | Documented shared decision-making | PARTIALLY_MET or NOT_ASSESSABLE | "to be completed and documented at the pre-procedure visit on 2026-11-02". A paperwork gap, so never UNMET. |

- **Contradictions to flag:**
  - Revascularization history: request form vs the 08-25 cath report and procedures list. Trust the cath report.
  - NYHA class: PCP vs EP.
  - Allergies: "NKDA" in the H&P vs iodinated contrast in the allergy list and both cath reports.
- **Rule fired:** `core_unmet` → LIKELY_DENY. This is a "not yet": the timing is a documented fact about the patient, not missing paperwork.
- **Appeal direction:** resubmit on or after **2026-11-23** (90 days after 08-25), with the shared decision-making note. A repeat LVEF is worth adding if the payer wants it measured after the waiting period.
- **Failure modes:**
  - NEED_MORE_INFO: pended on the shared decision-making note and missed the 08-25 PCI. This is the CT-01 pattern, a pending item hiding a documented failure.
  - LIKELY_APPROVE: trusted the request form and UR note. This is the worst error here.
  - Date arithmetic wrong: for example, measuring from the 06-10 PCI.
