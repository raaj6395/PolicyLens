export type Doc = { doc_id?: string; name: string; type?: string; date?: string; text: string }
export type Policy = { name: string; text: string }
export type Req = { case_id: string; documents: Doc[]; policy?: Policy; options?: { provider?: string; exclude_examples?: string[] } }

export type Source = { doc_id: string; quote: string; value: string; verified: boolean; match?: string; span?: [number, number] }
export type Fact = { fact_id: string; category: string; aspect: string; value: string; status: 'FOUND' | 'MISSING' | 'CONFLICT'; sources: Source[] | null; flags?: string[] }
export type Evidence = { fact_id: string; source_doc: string; doc_id: string; snippet: string; span?: [number, number] }
export type CriterionResult = { criterion_id: string; label?: string; criterion_text: string; core: boolean; any_of_group?: string; status: string; reasoning: string; evidence: Evidence[] }
export type Confidence = { level: string; score: number; rationale: string }
export type Decision = {
  rule_fired: string; explanation: string; bottom_line?: string; recommendation: string; necessity_category: string; workflow_state: string
  confidence: Confidence; confidence_penalties: { reason: string; amount: number }[] | null
}
export type Result = {
  trace_id: string; skill_version: string; provider: string; model: string; case_id: string
  requested_service: { description: string; codes: string[] | null; site_of_care: string }
  bottom_line?: string
  clinical_summary: string
  criteria_assessment: CriterionResult[]
  criteria_met: string[]; criteria_partial_or_unmet: string[]
  supporting_factors: string[] | null; weakening_factors: string[] | null
  contradictions: { issue: string; sources: string[] | null; preferred_source: string; why: string; evidence: Evidence[] }[]
  missing_information: { item: string; affects_criterion: string; why_it_matters: string }[] | null
  necessity_category: string; recommendation: string; workflow_state: string; confidence: Confidence
  provider_queries: { criterion_id: string; question: string; requested_document: string }[] | null
  appeal_direction: string; policy_used: string
}
export type Validation = { check: string; target: string; passed: boolean; detail?: string }
export type Stage = {
  name: string; started_at: string; duration_ms: number; input_summary?: any
  prompt?: { system_hash: string; skill_sections: string[]; examples?: string[]; system: string; user: string }
  raw_output?: string[]; parsed?: any; validations: Validation[]; retries: number; skipped?: string; error?: string
}
export type Trace = {
  trace_id: string; status: 'running' | 'done' | 'error'; case_id: string; skill_version: string; provider: string; model: string
  request: Req; stages: Stage[]; decision?: Decision; result?: Result; error?: string
}
export type Fixture = { title: string; request: Req; expected: { recommendation: string; why?: string; criteria?: { criterion_id: string; criterion_text: string; status: string }[] } }
export type EvalCase = {
  case_id: string; title: string; expected: string; expected_why?: string; got: string; correct: boolean; rule_fired?: string; confidence: Confidence
  criteria_comparison?: { criterion_id: string; expected_text: string; got_text: string; want_status: string; got_status: string; match: boolean }[]
  criteria_statuses: string[]; trace_id: string; duration_ms: number; error?: string
}
export type RunSummary = { trace_id: string; status: string; case_id: string; model: string; created_at: string; service?: string; recommendation?: string; confidence?: string; error?: string }
export type EvalReport = {
  mode: string; generated_at: string; skill_version: string; provider: string; model: string; cases: EvalCase[]
  accuracy: number; correct: number; total: number; labels: string[]; confusion: Record<string, Record<string, number>>
  more_info_vs_deny_confusions: number
}

const key = () => { try { return localStorage.getItem('apiKey') || '' } catch { return '' } }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-API-Key': key(), ...(init?.headers || {}) } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ? `${body.code}: ${body.error}` : `HTTP ${res.status}`)
  return body as T
}

export const api = {
  cases: () => call<Fixture[]>('/v1/cases'),
  skill: () => call<any>('/v1/skill'),
  evalReport: (mode: string) => call<EvalReport>(`/v1/eval?mode=${mode}`),
  trace: (id: string) => call<Trace>(`/v1/traces/${id}`),
  history: () => call<RunSummary[]>('/v1/traces'),
  runCase: (id: string) => call<{ trace_id: string }>(`/v1/cases/${encodeURIComponent(id)}/run?async=true`, { method: 'POST' }),
  feedback: (f: { trace_id: string; correct_label: string; reason: string }) => call<{ stored: boolean }>('/v1/feedback', { method: 'POST', body: JSON.stringify(f) }),
  assess: (req: Req) => call<{ trace_id: string }>('/v1/assess?async=true', { method: 'POST', body: JSON.stringify(req) }),
}

export const stageOf = (t: Trace | null, name: string) => t?.stages.find(s => s.name === name)
