# Data Inventory

Bundled in git today:

| Path | Contents |
|---|---|
| `data/fixtures/PA-001.json` … `PA-010.json` | Ten training scenarios (3 short documents each, no payer policy). Used by the API case picker and leave-one-out eval. |
| `skill/examples/PA-001.json` … `PA-010.json` | Few-shot exemplars derived from those scenarios. |
| `skill/SKILL.md`, `skill/schemas/`, `skill/VERSION` | Embedded skill loaded by the server. |
| `data/eval/` | Optional generated eval reports/traces (`go run ./cmd/eval`); not required to build. |

**Not in this repository:** the assignment **complex case** (multi-document input, gold criterion table, or saved run output). Run it locally with `POST /v1/assess` and your workbook copy. Paths are listed in `.gitignore` so they are not committed by mistake.

If you restore `data/workbook/*.md` from the assignment pack, `make seed` regenerates fixtures and examples from sheets 02 (training) only; complex sheets are no longer written into the repo by seed.

The 30 **Patient_Data_Aspects** from the workbook are encoded in `skill/SKILL.md` §Extraction guide (facts `F1`–`F30`).
