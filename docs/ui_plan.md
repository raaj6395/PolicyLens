# UI Redesign Plan: PolicyLens

Owner: Product. For: the engineer implementing it. Stack stays the same: React + Vite + Tailwind v4, existing tokens in `web/src/index.css`. **No new dependencies.**

---

## 1. Who uses this and what they came to do

| Who | What they need, in order |
|---|---|
| **Docstribe evaluator** (main user, often not technical) | 1. See the verdict on the complex case and *why*. 2. Check that every claim has a quote. 3. Try their own case. 4. See accuracy. |
| **Docstribe engineer** | Call the API, look at the trace, prompts and JSON, read the skill. |

The UI is built for the evaluator first. Technical depth stays available, but always **one click deeper** and never on the first screen.

**The one idea the UI must get across:** *a paperwork gap is not a denial.* Every screen should make the three outcomes (Approve / Needs more info / Deny) easy to tell apart.

---

## 2. What makes it feel complex today

Problems seen in the code, worst first:

1. **The same information appears 2–4 times on the result page.** The verdict appears in the Report card, in the Decide step, in the step 8 summary and in the step 8 body. Criteria appear in the Report and again in the Assess step. "Helps/Hurts", appeal direction and contradictions each appear twice. (`Run.tsx` `Report` plus `buildSteps`.)
2. **Too many controls on screen at once.** On the result page: header tabs, a Simple/Technical toggle, an API key field, "New review / change case", Present, Collapse all, Download, three right-pane tabs, and a JSON button on every step. That is about 15 controls before any content.
3. **The Simple/Technical toggle doubles everything.** Every string comes in two versions (`simple ? … : …` is used 36 times). Evaluators don't know which mode to pick, and code-function names leak into Simple mode as well.
4. **The case picker asks you to choose before you know anything.** "Submit your own packet" vs "Sample cases", then "View" vs "Run" on each row, then three separate lists.
5. **Text is too small.** `text-[11px]` and `text-xs` are the most common sizes. Most of the content is 11–12px.
6. **Too many coloured boxes.** Warn, accent, conflict, ok and bad tinted boxes sit next to each other in one criterion row, so nothing stands out.
7. **The source-document pane always takes 45% of the width**, even when nothing is highlighted.
8. **No URLs.** A result can't be linked or shared, and a refresh loses it.

---

## 3. Design principles (use these to settle arguments)

1. **Verdict first, proof on demand.** The answer goes at the top. Evidence is one click away. The pipeline internals are two clicks away.
2. **Say each thing once.** Every piece of data has one home. Other places link to it and don't repeat it.
3. **One vocabulary.** Use plain labels everywhere. Raw enums (`PARTIALLY_MET`) appear only in tooltips and JSON.
4. **Colour means status, and nothing else.** Green, amber, red and violet are only used for verdict and status. Everything else is neutral.
5. **Never colour alone.** Every status also has an icon and a text label.

---

## 4. Information architecture

Three top-level pages. They use hash routes so links can be shared and survive a refresh. Use native `location.hash` and the `hashchange` event; do not add a router library.

```
#/                     Home: start a review or open a sample
#/new                  New review (intake form)
#/r/:traceId           Result (also the live "running" view)
#/accuracy             Accuracy
#/how                  How it works (rulebook, pipeline, API, schemas)
```

Header has: logo · **Review** · **Accuracy** · **How it works**. Nothing else. The API key field moves to `#/how` → API section. The Simple/Technical toggle is **removed**.

---

## 5. Screens

### 5.1 Home `#/`

```
┌──────────────────────────────────────────────────────────────┐
│  Pre-auth review in minutes, with a quote for every claim.   │
│  Reads the packet, checks it against the payer policy, and   │
│  tells a paperwork gap apart from a real denial.             │
│                                                              │
│  [ See the showcase case → ]   [ Review your own packet ]    │
└──────────────────────────────────────────────────────────────┘

  How it works   ① Read  →  ② Check each rule  →  ③ Decide  →  ④ Explain
                 (one line each, links to #/how)

  Sample cases                        [All] [Workbook] [New tests]
  ───────────────────────────────────────────────────────────────
  ★ PA-001  Cervical decompression & fusion    Expected: ◐ Needs info  ›
    PA-002  Lumbar MRI                         Expected: ✓ Approve     ›
    SYN-004 Asthma biologic                    Expected: ✕ Deny        ›
```

- **One hero, two buttons.** "See the showcase case" opens the saved complex-case result straight away (no LLM wait). If there is no saved result, it runs the case live.
- **Sample cases is one list** with filter chips, replacing the three separate cards. The showcase case is pinned first with a ★.
- **The whole row is clickable, one action per row:** open the saved result if one exists, otherwise run it live. Remove the separate "View"/"Run" buttons; "Run again live" moves to the result page.
- The row tooltip shows `expected.why`.

### 5.2 New review `#/new`

The form becomes a vertical flow with three numbered sections. Only the documents section is open at first.

```
① Documents                                         3 added
  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐
     Drop .txt / .json files here, or  [paste text]
     Files named *policy* fill step ②. A request .json fills everything.
  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
  D1  Neurosurgery consult · 2026-10-14     1,240 chars   ✎  ✕
  D2  MRI cervical spine · 2026-09-30         610 chars   ✎  ✕

② Payer policy (recommended)                         [expand]
  ⚠ No policy: judged on past-case patterns, confidence capped at LOW.

③ [ Review this packet ]          Load an example ▾   · Advanced ▾
```

- **Drop zone instead of empty textareas.** Use the native `dragover`/`drop` events and reuse the existing `upload()`.
- Each document shows as a **one-line row**. Click ✎ to open the name/type/date/text editor inline. Only one row is open at a time.
- **Advanced** (collapsed) holds the Case ID and "Show as API call (curl)".
- The primary button is always visible (sticky at the bottom on mobile).
- On submit, go to `#/r/:traceId`.

### 5.3 Result `#/r/:traceId` (the main screen)

```
┌──────────────────────────────────────────────────────────────────┐
│ C5–C6 anterior cervical decompression & fusion · Inpatient · 22551│
│                                                                  │
│   ┌──────────────┬────────────────────┬──────────────┐           │
│   │   Approve    │ ◐ NEEDS MORE INFO  │     Deny     │  ← 3-way  │
│   └──────────────┴────────────────────┴──────────────┘    rail   │
│   Clinically plausible, documentation incomplete.                │
│   This is a paperwork gap, not a clinical denial.                │
│                                                                  │
│   Confidence  ▓▓▓▓▓▓░░░░  Medium · 0.62   why? ›                 │
│                                                                  │
│   ✓ Matches workbook label                          [⋯ More]     │
└──────────────────────────────────────────────────────────────────┘

  [ Policy rules 4/7 met ] [ Ask the provider 3 ] [ Case summary ⇄1 ] [ How it decided ]   [Documents (11)]
```

**Hero (always visible):**
- **3-way rail.** Three segments with the active one filled in its status colour and the others neutral. This is the single most important element: it shows the user straight away that "needs info" sits *between* approve and deny and is not the same as deny.
- One sentence for the necessity category, then the one-line `decision.explanation`.
- Confidence as a bar. "why?" opens a popover listing the base score and the penalties (from `confidence_penalties`).
- **Counts live in the tab labels, not in separate chips** ("Policy rules 4/7 met", "Ask the provider 3", "Case summary ⇄ 1"). *Changed during build:* separate stat chips repeated what the tabs already said, which broke principle 2.
- "✓ Matches workbook label" or "✕ Workbook expects X" only appears when the case is a fixture.
- `⋯ More` menu: Run again live · Download full report (JSON) · Copy link.

**Tab 1: Policy rules** (default)
```
  ◐ C4  Failed ≥6 weeks of conservative therapy            Partly met  ▾
        Reasoning: PT documented for 4 weeks; no end date…
        “completed 4 weeks of PT” — D3 PT note        [show in doc]
        Missing: PT discharge summary with dates
        Ask: “Please send the PT discharge summary showing…”
  ✓ C1  Myelopathy on exam                                 Met         ▸
  ✓ C2  Cord compression on MRI                            Met         ▸
```
- One row per criterion: icon, ID, plain criterion text, status label.
- **Sort order: Not met → Partly met → No information → Met.** Rows that aren't met start expanded. Met rows start collapsed. The reader's eye lands on what blocks approval.
- Mark admin (non-core) items with a small grey "admin" tag. Show any-of groups as "one of: C3a / C3b".
- Show at most 2 quotes, then "+N more".
- Clicking a quote opens the **Documents drawer** (see below) with that quote highlighted.

**Tab 2: What to ask the provider**
- A numbered list of `provider_queries`. Each one has a "fixes C4" tag and the document needed.
- **[Copy all as message]** builds plain text ready to paste into an email to the provider (use `navigator.clipboard`).
- The **"What would change the outcome"** card (appeal direction) sits below it.
- Empty state: "Nothing is missing. No questions needed."

**Tab 3: Case summary**
- `clinical_summary` as a readable paragraph (16px, max 70ch line length).
- Two columns: **Helps the case** / **Hurts the case**.
- **Where documents disagree** (contradictions), with "trusted source" and why.
- Requested service details and the policy it was judged against.

**Tab 4: How it decided** (all the technical depth lives here)
- A **horizontal stepper** with 8 steps (Read → Verify quotes → Check rules → Guardrails → Decide → Questions → Done). Each step shows a ✓, its duration, and a one-line summary. Clicking a step shows its detail below. Only one step is open at a time.
- Step details reuse the current bodies: `FactsBody`, quote verification, guardrail list, `DecisionBody` (rule ladder plus confidence breakdown). **Remove** the verdict, criteria, help/hurt and appeal blocks from the steps, because they are already in tabs 1–3.
- Inside each step: a "View JSON" toggle (prompt and raw output included) and a mono code reference (`internal/assess.Run`). This is the only place where enums and code paths appear.
- The footer has: trace ID · skill version · provider/model · Download full trace.

**Documents drawer** (replaces the permanent right column)
- A right-side drawer, 520px wide (full screen on mobile). Opening it: the "Documents (11)" button, or clicking any quote.
- At ≥1440px it **docks** next to the content instead of covering it, so the result and the source can be read side by side.
- A list of documents with the highlighted one scrolled into view. The payer policy is pinned as the last item.
- Esc closes it. Focus moves into the drawer and comes back to the trigger when it closes.

**Running state** (same URL, while `status === 'running'`)
- The hero is replaced by a centred progress card: the 8-step stepper animating, the current step's friendly label ("Checking every quote against the source…"), and the elapsed time.
- When the run finishes, it fades into the result. If it fails, show a plain-language error plus [Try again] and [Edit packet].

### 5.4 Accuracy `#/accuracy`

```
  On cases it never saw          9 / 10 correct
                                 0 times confused "needs info" with "deny"
  [Unseen cases (leave-one-out)] [New authored cases] [Training (in-sample)]

  Confusion matrix (3×3, plain labels)

  Case        Expected       Got            Conf.
  PA-003      ✓ Approve      ✓ Approve  ✓   High    ›
  PA-007      ◐ Needs info   ✕ Deny     ✕   Low     ›   ← red-tinted row
```
- Big number headline. The "needs info ↔ deny confusions" count sits right next to it, because it is the metric that matters most.
- Tabs are renamed to plain language. **Unseen cases** is the default.
- The per-case table has 5 columns. The criteria comparison moves into a row expand. A row click opens `#/r/:traceId`.

### 5.5 How it works `#/how`

One long page with a sticky table of contents on the left:
1. **The 4 steps**: the existing `HowItWorks` cards, in plain language.
2. **Decision rules**: the `RULES` ladder, shown statically.
3. **Three outcomes explained**: the 3-way rail with one paragraph per outcome.
4. **Rulebook**: SKILL.md rendered (existing `marked` code).
5. **Few-shot examples** and **Output schemas**: collapsed `<details>`, as today.
6. **API**: endpoint list, curl example, and the **API key field** (moved here from the header).

---

## 6. Visual system changes

Keep the existing token set and dark mode. Change the following:

| Item | Today | New |
|---|---|---|
| Type scale | 11 / 12 / 13 / 14 / 15 / 18 / 24 / 48 px in use | **12 / 14 / 16 / 20 / 28 / 40** only. Body 15→**16px** for summaries, 14px for UI. **Nothing below 12px.** |
| Content width | 1440px, two columns | **1080px** single column (reading). The drawer adds width when docked. |
| Status colours | Conflict orange is almost the same as warn amber | Conflict → **violet** (`#6d28d9` light / `#a78bfa` dark), so "documents disagree" is clearly different from "missing". |
| Tinted boxes | Up to 4 tinted boxes per criterion | **At most one tinted surface per section.** Missing and Ask become plain text lines with a small coloured label, not boxes. |
| Cards | Border on everything | Cards only for the hero and for top-level sections. Inside them, use dividers. |
| Status icons | Colour + text | Add a glyph: ✓ Met · ◐ Partly met · ✕ Not met · ? No info · ⇄ Conflict. Use inline SVG in `ui.tsx`, no icon library. |
| Radius / spacing | Mixed (lg, xl, 2xl) | `rounded-xl` for cards, `rounded-lg` for controls. Section gap 32px, row padding 16px. |

**Vocabulary (one table, used everywhere, defined once in `ui.tsx`):**

| Enum | Label | Short |
|---|---|---|
| LIKELY_APPROVE | Likely approve | Approve |
| NEED_MORE_INFO | Needs more info | Needs info |
| LIKELY_DENY | Likely deny | Deny |
| MET / PARTIALLY_MET / UNMET / NOT_ASSESSABLE | Met / Partly met / Not met / No information | |
| FOUND / MISSING / CONFLICT | Found / Not in packet / Sources disagree | |

The enum is shown in the `title` tooltip only.

---

## 7. What to delete

The engineer should end up with **less** code than today.

- `ModeCtx`, `useMode`, `Mode`, `Code` in `ui.tsx`, plus every `simple ? … : …` branch. Keep the plain-language string. Where the technical string adds value (code paths, enum IDs), move it into the "How it decided" step details.
- Present mode (`present`, `step`, the key handler, the floating Back/Next bar). The stepper in "How it decided" replaces it.
- "Collapse all / Expand all".
- The `Report` duplicate blocks inside `buildSteps` (the step 8 body, the criteria cards in `CriteriaBody`, and the help/hurt and appeal blocks inside steps).
- The right-pane tabs "Final answer JSON" / "Full trace JSON". These move to `⋯ More → Download` and to the per-step JSON in "How it decided".
- `CasePicker`'s "Submit your own / Sample cases" segmented control, and the separate featured/training/authored cards.
- `STAGES` in `ui.tsx`. Nothing references it today.

---

## 8. Accessibility and responsiveness (must-have)

- All interactive rows are `<button>` or `<a>`, never a clickable `<div>`. (The `CriteriaBody` card currently uses `onClick` on a div.)
- Focus rings stay visible (`focus-visible:ring-2 ring-accent`).
- Tabs use `role="tablist"` and arrow-key navigation.
- Status is never shown by colour alone (see icons above). Contrast is AA in both themes.
- At 375px width: no horizontal scroll. The hero rail stacks. The tabs scroll horizontally. The drawer goes full-screen.
- `prefers-reduced-motion` turns off the stepper animation and smooth scrolling.

---

## 9. Delivery phases

Each phase can be shipped on its own and is reviewed in the running app.

| Phase | Scope | Done when |
|---|---|---|
| **P0 Foundations** | Remove the mode toggle; vocabulary table; status icons; type scale; violet conflict token; hash routing | The app works as before, the toggle is gone, no text is below 12px, and refreshing `#/r/:id` reloads the result |
| **P1 Result page** | Hero with 3-way rail and chips; 4 tabs; documents drawer; running state; remove duplicates | The showcase case shows the verdict, confidence and blocking rules **without scrolling** on a 1366×768 screen; every quote opens the drawer highlighted; no fact appears twice |
| **P2 Home + New review** | Hero CTAs, a single case list with filters, drop-zone intake, collapsed advanced settings | A first-time user reaches the showcase result in **1 click** and submits a pasted packet in **≤3 actions** |
| **P3 Accuracy + How it works** | Headline metric, simplified table, merged rulebook/API page with the API key | The header has exactly 3 nav items and no form fields |

---

## 10. Success checks (run before sign-off)

1. **5-second test.** Show the result page to someone non-technical for 5 seconds. They can say the verdict and whether it is a paperwork problem or a real denial.
2. **Traceability test.** Pick any claim on tabs 1–3. It reaches its highlighted source sentence in **≤2 clicks**.
3. **Control count.** At most **6 interactive controls** above the fold on the result page (today it is about 15).
4. **No duplication.** Search the rendered result page for the verdict label. It appears in the hero only (plus the "How it decided" decision step).
5. Works in light and dark mode, and at 375 / 1366 / 1920px widths.

---

## 11. Out of scope (for now)

- Editing a packet and re-running from the result page ("Edit packet" goes back to `#/new` pre-filled; inline editing is skipped).
- Run history and saved cases beyond the bundled eval traces.
- A PDF export (JSON download covers auditability; add PDF if Docstribe asks for it).
