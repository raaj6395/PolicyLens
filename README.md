# PolicyLens

**PolicyLens** is a reusable LLM skill and API that reads a messy pre-authorization packet and returns an auditable recommendation: `LIKELY_APPROVE`, `NEED_MORE_INFO` or `LIKELY_DENY`. Each criterion gets a status, every claim is linked to a verified quote, confidence is calibrated in code, and the output includes provider queries and an appeal direction.

- **Approach (short note):** [docs/approach.md](docs/approach.md) · **Technical design:** [docs/design.md](docs/design.md) · **Handback:** [docs/deliverable.md](docs/deliverable.md)
- **Eval:** [leave-one-out](docs/eval_results_loo.md) · [in-sample](docs/eval_results_insample.md) · [error analysis](docs/error_analysis.md)
- **Production notes:** [docs/production.md](docs/production.md)
- **The skill itself:** [skill/SKILL.md](skill/SKILL.md), [schemas](skill/schemas/), [examples](skill/examples/)
- **Data:** [docs/data_inventory.md](docs/data_inventory.md) · [docs/denial_patterns.md](docs/denial_patterns.md)

## Run it

Requirements: Go 1.25+, Node 20+, and one LLM provider.

```bash
cp .env.example .env     # then put GEMINI_API_KEY, OPENAI_API_KEY and/or GROQ_API_KEY in .env
make run                 # builds web/ + server, serves on :8080
```

The server and `cmd/eval` read `.env` from the working directory at startup. Real environment variables take priority. OpenAI `gpt-4.1` is the default; other providers are opt-in via `LLM_PROVIDER`. `.env` is in `.gitignore` and `.dockerignore`, so keys never reach git or the image. Pass them to Docker with `--env-file .env`.

Open http://localhost:8080 for the demo. Bundled cases are **PA-001…PA-010** (training scenarios). The workbook complex case is **not** in this repo; use `POST /v1/assess` with your own packet JSON.

| Env var | Default | Meaning |
|---|---|---|
| `LLM_PROVIDER` | openai | `openai`, `gemini`, `groq` or `ollama` |
| `LLM_MODEL` | gpt-4.1 / gemini-2.5-flash / llama-3.3-70b-versatile / gpt-oss:120b-cloud | model for the default provider |
| `LLM_BASE_URL` | provider default | override, e.g. `http://host.docker.internal:11434/v1` |
| `API_KEY` | unset (open) | if set, POST endpoints require `X-API-Key` |
| `RATE_LIMIT_PER_MIN` | 10 | per-IP limit on LLM-calling endpoints |
| `PORT` | 8080 | |

Docker: `make docker && docker run -p 8080:8080 --env-file .env policylens`. The image is distroless and works on Render, Fly.io or Railway.

## API

```bash
# assess any packet (documents required; policy strongly recommended)
curl -s localhost:8080/v1/assess -H 'Content-Type: application/json' -d @examples/no_policy_request.json | jq

# same, plus the full stage-by-stage trace in one body
curl -s 'localhost:8080/v1/assess?include_trace=true' -H 'Content-Type: application/json' -d @examples/no_policy_request.json

# async: returns {trace_id} immediately; poll the trace until status != running
curl -s -X POST 'localhost:8080/v1/assess?async=true' -H 'Content-Type: application/json' -d @examples/no_policy_request.json
curl -s localhost:8080/v1/traces/<trace_id> | jq '.status, .result.recommendation'

# bundled training cases (PA-001 … PA-010)
curl -s localhost:8080/v1/cases | jq '.[].request.case_id'
curl -s -X POST 'localhost:8080/v1/cases/PA-001/run?async=true' -H 'Content-Type: application/json'

curl -s localhost:8080/v1/skill | jq .version
curl -s 'localhost:8080/v1/eval?mode=loo' | jq '.accuracy'
curl -s localhost:8080/v1/feedback -H 'Content-Type: application/json' -d '{"trace_id":"...","correct_label":"NEED_MORE_INFO","reason":"..."}'
```

Request body:

```json
{
  "case_id": "PA-001",
  "documents": [{"name": "Surgeon consult", "type": "clinical_note", "date": "2026-09-01", "text": "..."}],
  "policy": {"name": "Commercial Spine Surgery Policy v2026.1", "text": "..."},
  "options": {"provider": "gemini", "exclude_examples": ["PA-001"]}
}
```

The response follows the output contract: `requested_service`, `bottom_line` (one plain sentence written by code), `clinical_summary`, `criteria_assessment[]` (`label` (a 2–4 word name), status, reasoning, `evidence[]` with `fact_id`, `doc_id`, `source_doc`, `snippet`, `span`), `criteria_met`, `criteria_partial_or_unmet`, `supporting_factors`, `weakening_factors`, `contradictions`, `missing_information`, `necessity_category`, `recommendation`, `workflow_state`, `confidence {level, score, rationale}`, `provider_queries[]`, `appeal_direction`, plus `trace_id`, `skill_version`, `provider` and `model`. Errors return `{error, code, details}`. IDs (`D#` documents, `F#` facts, `C#` criteria) stay in the JSON as stable audit references; the demo UI shows names instead. Reviewer feedback: `POST /v1/feedback {trace_id, correct_label, reason}`.

## Develop

```bash
make test             # decision rules, quote verification, guardrails, pipeline with a fake LLM
make seed             # regenerate skill/examples + data/fixtures from data/workbook/*.md
make eval             # leave-one-out over PA-001…PA-010 → data/eval/, docs/eval_results_loo.md
make eval-insample
go run ./cmd/eval -mode synthetic   # the 10 authored SYN- cases with their own policies
cd web && npm run dev # frontend on :5173, proxied to the Go server on :8080
```

## Layout

```
cmd/server  cmd/eval  cmd/seed
internal/{api,pipeline,extract,assess,validate,decide,queries,llm,trace,model}
skill/      SKILL.md, VERSION, schemas/, examples/, loader (embedded)
data/       workbook/ (sheet exports), fixtures/, eval/ (reports + traces, embedded)
web/        React demo (embedded)
docs/
```
