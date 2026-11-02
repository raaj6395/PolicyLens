import type { ReactNode } from 'react'
import type { CriterionResult, Evidence, Fact, Fixture, Result, Trace } from './api'
import { stageOf } from './api'
import {
  Badge, CATEGORY, Glyph, Humane, LEVEL, Rail, RULES, STATUS, StatusDot, TEXT, TONE,
  Verdict, WORKFLOW, fmtDate, plain, prettyType, shortLabel, type Lex,
} from './ui'

const SORT: Record<string, number> = { UNMET: 0, PARTIALLY_MET: 1, NOT_ASSESSABLE: 2, MET: 3 }
const ms = (n?: number) => n == null ? '' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`

function Sec({ title, sub, children, pageBreak }: { title: string; sub?: string; children: ReactNode; pageBreak?: boolean }) {
  return (
    <section className={`print-sec card overflow-hidden ${pageBreak ? 'print-break-before' : ''}`}>
      <div className="border-b border-line bg-sunken/80 px-5 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function PrintQuote({ e, lex }: { e: Evidence; lex: Lex }) {
  const date = fmtDate(lex.doc[e.doc_id]?.date)
  return (
    <blockquote className="print-quote border-l-[3px] border-accent bg-sunken/70 py-2 pl-3 pr-2 text-sm leading-relaxed text-soft">
      <p className="text-ink">“{e.snippet}”</p>
      <footer className="mt-1 text-xs text-muted">
        {e.source_doc}{date && ` · ${date}`}
        <span className="font-mono"> · {e.fact_id}</span>
      </footer>
    </blockquote>
  )
}

function CriterionBlock({ c, n, lex, missing, queries }: {
  c: CriterionResult; n: number; lex: Lex
  missing: NonNullable<Result['missing_information']>
  queries: NonNullable<Result['provider_queries']>
}) {
  const st = STATUS[c.status]
  return (
    <li className="print-avoid-break border-b border-line py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <StatusDot status={c.status} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Requirement {n}</p>
          <p className="mt-0.5 text-base font-semibold text-ink">{shortLabel(c)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge status={c.status} />
            {c.core ? <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">Core</span> : (
              <span className="rounded-md bg-sunken px-1.5 py-0.5 text-xs text-muted">Paperwork item</span>
            )}
            {c.any_of_group && <span className="rounded-md bg-sunken px-1.5 py-0.5 text-xs text-muted">Group {c.any_of_group}</span>}
            <span className="font-mono text-xs text-muted">{c.criterion_id}</span>
          </div>
          {c.criterion_text && <p className="mt-2 text-sm text-muted">{c.criterion_text}</p>}
          <p className="mt-2 text-sm leading-relaxed text-soft"><Humane text={c.reasoning} lex={lex} crit /></p>
          {c.evidence.length > 0 ? (
            <div className="mt-3 space-y-2">{c.evidence.map((e, i) => <PrintQuote key={i} e={e} lex={lex} />)}</div>
          ) : (
            <p className="mt-2 text-sm italic text-muted">No supporting quote in the packet.</p>
          )}
          {missing.map((m, i) => (
            <p key={`m${i}`} className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
              <span className="font-semibold">Missing</span> <Humane text={m.item} lex={lex} /> — <span className="text-soft"><Humane text={m.why_it_matters} lex={lex} /></span>
            </p>
          ))}
          {queries.map((q, i) => (
            <p key={`q${i}`} className="mt-2 rounded-lg bg-accent-soft px-3 py-2 text-sm">
              <span className="font-semibold text-accent">Ask provider</span>{' '}
              <span className="text-soft"><Humane text={q.question} lex={lex} /></span>
            </p>
          ))}
        </div>
        {st && <span className={`hidden shrink-0 text-sm font-semibold sm:block ${TEXT[st.tone]}`}>{st.label}</span>}
      </div>
    </li>
  )
}

const hits = (ref: string, id: string) => ref.split(/[^A-Za-z0-9]+/).includes(id)

export function PrintReport({ r, trace, title, lex, facts, fixture, docs, docName }: {
  r: Result; trace: Trace; title: string; lex: Lex; facts: Fact[]; fixture?: Fixture
  docs: Trace['request']['documents']; docName: (id: string) => string
}) {
  const qs = r.provider_queries ?? []
  const missing = r.missing_information ?? []
  const criteria = [...(r.criteria_assessment ?? [])].sort((a, b) => (SORT[a.status] ?? 2) - (SORT[b.status] ?? 2))
  const d = trace.decision
  const quoteFails = stageOf(trace, 'validate_facts')?.validations.filter(v => !v.passed) ?? []
  const guardFails = stageOf(trace, 'validate_assessment')?.validations.filter(v => !v.passed) ?? []
  const sortedFacts = [...facts].sort((a, b) => +a.fact_id.slice(1) - +b.fact_id.slice(1))
  const printed = fmtDate(new Date().toISOString().slice(0, 10))
  const expected = fixture?.expected.recommendation
  const fired = d ? RULES.findIndex(x => x.id === d.rule_fired) : -1
  const foundN = sortedFacts.filter(f => f.status !== 'MISSING' && f.aspect !== 'Contradictory documentation flags').length
  const confTone = r.confidence.level === 'HIGH' ? 'ok' : r.confidence.level === 'MEDIUM' ? 'warn' : 'bad'

  return (
    <article className="print-root hidden bg-canvas text-sm leading-relaxed text-ink print:block">
      <div className="print-cover print-avoid-break border-b border-line bg-surface px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-ink">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 9v6M9 12h6" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="eyebrow">PolicyLens · medical-necessity review</p>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
            </div>
          </div>
          <div className="text-right text-xs text-muted">
            <p>Report date · {printed}</p>
            <p className="font-mono">Case {r.case_id}</p>
            <p className="font-mono">Trace {trace.trace_id}</p>
          </div>
        </div>

        <p className="mt-4 text-base text-soft">
          {r.requested_service.description}
          {r.requested_service.site_of_care && <span className="text-muted"> · {r.requested_service.site_of_care}</span>}
          {(r.requested_service.codes?.length ?? 0) > 0 && <span className="text-muted"> · {r.requested_service.codes!.join(', ')}</span>}
        </p>

        <div className="mt-6">
          <Rail rec={r.recommendation} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="space-y-2">
            <p className="text-base font-medium leading-snug text-ink">
              <Humane text={r.bottom_line || d?.bottom_line || CATEGORY[r.necessity_category]} lex={lex} crit />
            </p>
            {d?.explanation && <p className="text-sm text-soft"><Humane text={d.explanation} lex={lex} crit /></p>}
            <p className="text-sm text-muted">{CATEGORY[r.necessity_category] ?? r.necessity_category}</p>
            <p className="text-xs text-muted">{WORKFLOW[r.workflow_state] ?? r.workflow_state}</p>
          </div>
          <div className={`rounded-xl border border-line p-4 ${TONE[confTone as keyof typeof TONE]}`}>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Confidence</p>
            <p className="mt-1 text-2xl font-semibold">{LEVEL[r.confidence.level] ?? r.confidence.level}</p>
            <p className="font-mono text-sm">{r.confidence.score.toFixed(2)}</p>
            <p className="mt-2 text-xs leading-relaxed opacity-90">{r.confidence.rationale}</p>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          Judged against: <span className="text-soft">{r.policy_used || 'No policy supplied (learned patterns only)'}</span>
          {' · '}Skill {trace.skill_version} · {trace.provider}/{trace.model}
        </p>
      </div>

      <div className="space-y-5 px-6 py-6">
        {expected && (
          <Sec title="Evaluator label">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Expected <Verdict rec={expected} /></span>
              <span className="text-muted">→</span>
              <span>Got <Verdict rec={r.recommendation} /></span>
              {expected === r.recommendation
                ? <span className="inline-flex items-center gap-1 text-ok"><Glyph kind="check" /> Match</span>
                : <span className="inline-flex items-center gap-1 text-bad"><Glyph kind="x" /> Mismatch</span>}
            </div>
            {fixture?.expected.why && <p className="mt-2 text-sm text-soft">{fixture.expected.why}</p>}
          </Sec>
        )}

        <Sec title="Clinical summary">
          <p className="text-base leading-7 text-soft">{plain(r.clinical_summary, lex)}</p>
        </Sec>

        {((r.supporting_factors?.length ?? 0) > 0 || (r.weakening_factors?.length ?? 0) > 0) && (
          <div className="grid gap-5 md:grid-cols-2">
            {(r.supporting_factors?.length ?? 0) > 0 && (
              <Sec title="Strengths">
                <ul className="space-y-2">{r.supporting_factors!.map((x, i) => (
                  <li key={i} className="flex gap-2 text-sm text-soft"><Glyph kind="check" className="mt-1 h-3.5 w-3.5 shrink-0 text-ok" /><span>{plain(x, lex)}</span></li>
                ))}</ul>
              </Sec>
            )}
            {(r.weakening_factors?.length ?? 0) > 0 && (
              <Sec title="Concerns">
                <ul className="space-y-2">{r.weakening_factors!.map((x, i) => (
                  <li key={i} className="flex gap-2 text-sm text-soft"><Glyph kind="x" className="mt-1 h-3.5 w-3.5 shrink-0 text-bad" /><span>{plain(x, lex)}</span></li>
                ))}</ul>
              </Sec>
            )}
          </div>
        )}

        {criteria.length > 0 && (
          <Sec title="Policy requirements" sub={`${criteria.filter(c => c.status === 'MET').length} of ${criteria.length} satisfied · each backed by verified quotes where shown`}>
            <ul>{criteria.map((c, i) => (
              <CriterionBlock key={c.criterion_id} c={c} n={i + 1} lex={lex}
                missing={missing.filter(m => hits(m.affects_criterion, c.criterion_id))}
                queries={qs.filter(q => hits(q.criterion_id, c.criterion_id))} />
            ))}</ul>
          </Sec>
        )}

        {missing.filter(m => !criteria.some(c => hits(m.affects_criterion, c.criterion_id))).length > 0 && (
          <Sec title="Also missing from the packet">
            <ul className="space-y-2 text-sm">{missing.filter(m => !criteria.some(c => hits(m.affects_criterion, c.criterion_id))).map((m, i) => (
              <li key={i} className="rounded-lg bg-warn-soft px-3 py-2"><span className="font-semibold text-warn">Missing</span>{' '}<Humane text={m.item} lex={lex} /> — <Humane text={m.why_it_matters} lex={lex} /></li>
            ))}</ul>
          </Sec>
        )}

        {(r.contradictions?.length ?? 0) > 0 && (
          <Sec title="Where the documents disagree">
            <ul className="space-y-4">
              {r.contradictions!.map((c, i) => (
                <li key={i} className="rounded-xl bg-conflict-soft p-4">
                  <p className="font-medium text-conflict"><Humane text={c.issue} lex={lex} /></p>
                  <p className="mt-1 text-sm text-soft"><span className="font-semibold">Trusted:</span> <Humane text={c.preferred_source} lex={lex} />. <Humane text={c.why} lex={lex} /></p>
                  {(c.evidence ?? []).map((e, j) => <div key={j} className="mt-2"><PrintQuote e={e} lex={lex} /></div>)}
                </li>
              ))}
            </ul>
          </Sec>
        )}

        {qs.length > 0 && (
          <Sec title="Questions for the provider">
            <ol className="space-y-3">
              {qs.map((q, i) => (
                <li key={i} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-xs font-bold text-accent">{i + 1}</span>
                  <div>
                    <p className="text-base leading-relaxed text-ink">{plain(q.question, lex)}</p>
                    <p className="mt-1 text-xs text-muted">
                      {lex.crit[q.criterion_id] && <>For: <b className="text-soft">{lex.crit[q.criterion_id]}</b> · </>}
                      Needs: {plain(q.requested_document, lex)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </Sec>
        )}

        {r.appeal_direction && (
          <Sec title="What would change the decision">
            <p className="rounded-xl bg-accent-soft p-4 text-base leading-relaxed text-soft">{plain(r.appeal_direction, lex)}</p>
          </Sec>
        )}

        {d && (
          <Sec title="How the verdict was decided" sub="Fixed rules in code — same checks every run">
            <p className="mb-3 text-sm text-soft">Rule fired: <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">{d.rule_fired}</code></p>
            <ol className="space-y-2">
              {RULES.map((x, k) => (
                <li key={x.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${k === fired ? 'bg-accent-soft ring-2 ring-accent/40' : k < fired ? 'text-muted line-through decoration-muted/40' : 'text-muted'}`}>
                  <span className="font-mono text-xs">{k + 1}.</span>
                  <span className="min-w-0 flex-1">{x.when}</span>
                  <Verdict rec={x.then} short />
                  {k === fired && <span className="text-xs font-bold text-accent">← fired</span>}
                </li>
              ))}
            </ol>
            {(d.confidence_penalties?.length ?? 0) > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
                {d.confidence_penalties!.map((p, i) => <li key={i}>−{p.amount.toFixed(2)} {p.reason}</li>)}
              </ul>
            )}
          </Sec>
        )}

        <Sec title="Fact sheet" sub={`${foundN} found · ${sortedFacts.filter(f => f.status === 'MISSING').length} not in packet`} pageBreak>
          <ul className="divide-y divide-line rounded-lg border border-line overflow-hidden">
            {sortedFacts.map(f => (
              <li key={f.fact_id} className="print-avoid-break grid gap-2 bg-surface px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                <div>
                  <p className="font-medium text-ink">{f.aspect}</p>
                  <p className="text-xs text-muted">{f.category}</p>
                  <div className="mt-1"><Badge status={f.status} /></div>
                  <p className="mt-1 font-mono text-xs text-muted">{f.fact_id}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-soft">{f.value || '—'}</p>
                  {(f.sources ?? []).map((s, i) => (
                    <p key={i} className="mt-2 border-l-2 border-line pl-2 text-xs text-muted">“{s.quote}” — {docName(s.doc_id)}</p>
                  ))}
                  {f.flags?.map((flag, i) => <p key={i} className="mt-1 text-xs text-warn">{flag}</p>)}
                </div>
              </li>
            ))}
          </ul>
        </Sec>

        <Sec title="Documents in packet" sub={`${docs.length} document${docs.length === 1 ? '' : 's'}`}>
          <div className="print-table-wrap overflow-hidden rounded-lg border border-line">
            <table className="print-table w-full text-sm">
              <thead><tr className="bg-sunken text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">ID</th><th>Name</th><th>Type</th><th>Date</th><th>Size</th>
              </tr></thead>
              <tbody className="divide-y divide-line bg-surface">
                {docs.map(doc => (
                  <tr key={doc.doc_id}>
                    <td className="px-3 py-2 font-mono text-xs text-muted">{doc.doc_id}</td>
                    <td className="px-3 py-2 font-medium">{doc.name}</td>
                    <td className="px-3 py-2 text-muted">{prettyType(doc.type)}</td>
                    <td className="px-3 py-2 text-muted">{doc.date ? fmtDate(doc.date) : '—'}</td>
                    <td className="px-3 py-2 text-muted">{doc.text.length.toLocaleString()} chars</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trace.request.policy && (
            <p className="mt-3 rounded-lg bg-sunken px-3 py-2 text-sm text-soft">
              <span className="font-semibold text-ink">Policy excerpt:</span> {trace.request.policy.name} ({trace.request.policy.text.length.toLocaleString()} characters)
            </p>
          )}
        </Sec>

        {(quoteFails.length > 0 || guardFails.length > 0) && (
          <Sec title="Guardrails applied">
            <ul className="space-y-2 text-sm">
              {quoteFails.map((v, i) => <li key={`q${i}`} className="rounded-lg bg-warn-soft px-3 py-2 text-warn">{v.target}: {v.detail}</li>)}
              {guardFails.map((v, i) => <li key={`g${i}`} className="rounded-lg bg-warn-soft px-3 py-2 text-warn">{v.target}: {v.detail}</li>)}
            </ul>
          </Sec>
        )}

        <Sec title="Pipeline timing">
          <div className="print-table-wrap overflow-hidden rounded-lg border border-line">
            <table className="print-table w-full text-sm">
              <thead><tr className="bg-sunken text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-3 py-2">Stage</th><th>Duration</th><th>Notes</th>
              </tr></thead>
              <tbody className="divide-y divide-line bg-surface">
                {trace.stages.map(s => (
                  <tr key={s.name}>
                    <td className="px-3 py-2 font-mono text-xs">{s.name}</td>
                    <td className="px-3 py-2">{ms(s.duration_ms)}</td>
                    <td className="px-3 py-2 text-muted">{s.error ? `Error: ${s.error}` : s.skipped ? `Skipped: ${s.skipped}` : s.retries ? `${s.retries} retries` : s.validations?.length ? `${s.validations.filter(v => v.passed).length}/${s.validations.length} checks passed` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>

        <footer className="print-avoid-break border-t border-line pt-4 text-center text-xs text-muted">
          Generated {printed} by PolicyLens · Recommendation for a human utilization reviewer, not a coverage determination or medical advice.
        </footer>
      </div>
    </article>
  )
}
