import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, stageOf, type CriterionResult, type Evidence, type Fact, type Fixture, type Result, type Stage, type Trace } from './api'
import { JsonPanel, saveJson } from './Json'
import { PrintReport } from './PrintReport'
import { Badge, CATEGORY, CATEGORY_SHORT, Glyph, Humane, Rail, RULES, STATUS, StatusDot, TEXT, Tabs, VERDICT, VERDICT_ORDER, Verdict, WORKFLOW, caseTitle, daysBefore, fmtDate, friendlyError, makeLex, plain, prettyType, shortLabel, type Lex } from './ui'

function printReport() {
  requestAnimationFrame(() => window.print())
}

function downloadReportJson(trace: Trace) {
  saveJson(`policylens-report_${trace.case_id}_${trace.trace_id}`, { exported_at: new Date().toISOString(), ...trace })
}

type Mark = { doc_id: string; span: [number, number] }
type StepStatus = 'done' | 'running' | 'error' | 'pending'
type Tab = 'rules' | 'facts' | 'ask' | 'summary' | 'how'

const STEPS = [
  { key: 'ingest', stages: ['ingest'], ai: false, title: 'Receive packet', doing: 'Receiving the packet…', code: 'internal/pipeline.(*Pipeline).Start' },
  { key: 'extract', stages: ['extract'], ai: true, title: 'Read documents', doing: 'Reading every document and pulling out the facts…', code: 'internal/extract.Run' },
  { key: 'quotes', stages: ['validate_facts'], ai: false, title: 'Verify quotes', doing: 'Checking every quote against its source…', code: 'internal/validate.Facts' },
  { key: 'assess', stages: ['assess'], ai: true, title: 'Check policy rules', doing: 'Checking each requirement of the payer policy…', code: 'internal/assess.Run' },
  { key: 'guard', stages: ['validate_assessment'], ai: false, title: 'Guardrails', doing: 'Double-checking the reasoning…', code: 'internal/validate.RepairAssessment' },
  { key: 'decide', stages: ['decide'], ai: false, title: 'Decide', doing: 'Applying the decision rules…', code: 'internal/decide.Decide' },
  { key: 'queries', stages: ['queries'], ai: true, title: 'Draft questions', doing: 'Drafting questions for the provider…', code: 'internal/queries.Run' },
  { key: 'result', stages: ['assemble'], ai: false, title: 'Done', doing: 'Packaging the result…', code: 'internal/pipeline.Assemble' },
]
type StepKey = (typeof STEPS)[number]['key']

const SORT: Record<string, number> = { UNMET: 0, PARTIALLY_MET: 1, NOT_ASSESSABLE: 2, MET: 3 }
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const hits = (ref: string, id: string) => ref.split(/[^A-Za-z0-9]+/).includes(id)
const ms = (n?: number) => n == null ? '' : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`

function stepStatuses(trace: Trace): StepStatus[] {
  const st: StepStatus[] = STEPS.map(s => {
    const xs = s.stages.map(n => stageOf(trace, n))
    if (xs.some(x => x?.error)) return 'error'
    if (s.key === 'result' ? !!trace.result : xs.every(Boolean)) return 'done'
    return 'pending'
  })
  const first = st.indexOf('pending')
  if (trace.status === 'running' && first >= 0) st[first] = 'running'
  return st
}

export function RunView({ trace, fixture, onRerun, onEdit }: { trace: Trace; fixture?: Fixture; onRerun: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<Tab>('rules')
  const [marks, setMarks] = useState<Mark[] | null>(null)
  useEffect(() => { setMarks(null); setTab('rules') }, [trace.trace_id])

  const docs = trace.request.documents
  const docName = (id: string) => docs.find(d => d.doc_id === id)?.name ?? id
  const facts: Fact[] = stageOf(trace, 'validate_facts')?.parsed?.facts ?? []
  const factMap = useMemo(() => Object.fromEntries(facts.map(f => [f.fact_id, f])), [facts])
  const factMarks = (id: string): Mark[] => (factMap[id]?.sources ?? []).filter(s => s.span).map(s => ({ doc_id: s.doc_id, span: s.span! }))
  const show = {
    fact: (id: string) => setMarks(factMarks(id)),
    quote: (e: Evidence) => setMarks(e.span ? [{ doc_id: e.doc_id, span: e.span }] : factMarks(e.fact_id)),
    all: (es: Evidence[]) => setMarks(es.filter(e => e.span).map(e => ({ doc_id: e.doc_id, span: e.span! }))),
    doc: (id: string) => { const d = docs.find(x => x.doc_id === id); if (d) setMarks([{ doc_id: id, span: [0, d.text.length] }]) },
    docs: () => setMarks([]),
  }
  const title = fixture ? caseTitle(fixture.title) : trace.case_id
  const r = trace.result
  const statuses = stepStatuses(trace)
  const lex = useMemo(() => makeLex(docs, facts, r?.criteria_assessment ?? []), [docs, facts, r])

  return (
    <div>
      <div className="no-print space-y-6">
        <nav className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <a href="#/" className="link shrink-0">← All cases</a>
          <span>/</span>
          <span className="min-w-0 truncate text-ink">{title}</span>
        </nav>

        {trace.status === 'running' && <Running trace={trace} statuses={statuses} />}
        {trace.status === 'error' && <Failed trace={trace} statuses={statuses} onRerun={onRerun} onEdit={onEdit} />}
        {trace.status === 'done' && r && (
          <>
            <Hero r={r} trace={trace} fixture={fixture} lex={lex} onRerun={onRerun} onEdit={onEdit} />
            <Body r={r} trace={trace} facts={facts} statuses={statuses} tab={tab} setTab={setTab} show={show} docName={docName} lex={lex} />
          </>
        )}
      </div>
      {trace.status === 'done' && r && (
        <PrintReport r={r} trace={trace} title={title} lex={lex} facts={facts} fixture={fixture} docs={docs} docName={docName} />
      )}
      {marks && <Drawer docs={docs} policy={trace.request.policy} marks={marks} lex={lex} onClose={() => setMarks(null)} />}
    </div>
  )
}

type Show = { fact: (id: string) => void; quote: (e: Evidence) => void; all: (es: Evidence[]) => void; doc: (id: string) => void; docs: () => void }

function Stepper({ statuses, trace, active, onPick }: { statuses: StepStatus[]; trace: Trace; active?: StepKey; onPick?: (k: StepKey) => void }) {
  return (
    <ol className="grid grid-cols-4 gap-x-2 gap-y-4 lg:grid-cols-8">
      {STEPS.map((s, i) => {
        const st = statuses[i]
        const bar = st === 'done' ? 'bg-ok' : st === 'running' ? 'animate-pulse bg-accent' : st === 'error' ? 'bg-bad' : 'bg-line'
        const inner = (
          <>
            <span className={`block h-1 rounded-full ${bar}`} />
            <span className="mt-2 flex items-center gap-1 text-xs text-muted">
              {st === 'done' ? <Glyph kind="check" className="h-3 w-3 text-ok" /> : st === 'error' ? <Glyph kind="x" className="h-3 w-3 text-bad" /> : <span className="font-mono">{i + 1}</span>}
              {s.ai ? 'AI' : 'Code'}
              {st === 'done' && <span>· {ms(stageOf(trace, s.stages[0])?.duration_ms)}</span>}
            </span>
            <span className={`block text-sm font-medium ${st === 'pending' ? 'text-muted' : 'text-ink'}`}>{s.title}</span>
          </>
        )
        return (
          <li key={s.key}>
            {onPick
              ? <button onClick={() => onPick(s.key)} aria-current={active === s.key ? 'step' : undefined} className={`w-full rounded-lg p-2 text-left transition hover:bg-sunken ${active === s.key ? 'bg-sunken ring-1 ring-accent' : ''}`}>{inner}</button>
              : <div className="p-2">{inner}</div>}
          </li>
        )
      })}
    </ol>
  )
}

function Running({ trace, statuses }: { trace: Trace; statuses: StepStatus[] }) {
  const [now, setNow] = useState(Date.now())
  const [start] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const cur = STEPS[Math.max(0, statuses.indexOf('running'))]
  const n = trace.request.documents.length
  const doing: Partial<Record<StepKey, string>> = {
    extract: `Reading ${n} document${n === 1 ? '' : 's'} and pulling out the facts…`,
    assess: trace.request.policy ? `Checking each requirement of ${trace.request.policy.name}…` : 'Checking the case against patterns learned from past cases…',
  }
  return (
    <section className="card space-y-6 p-6 sm:p-8" aria-live="polite">
      <div className="flex items-center gap-4">
        <span className="h-8 w-8 shrink-0 animate-spin rounded-full border-[3px] border-line border-t-accent" />
        <div>
          <h1 className="text-xl font-semibold">Reviewing the packet</h1>
          <p className="text-sm text-soft">{doing[cur.key] ?? cur.doing} <span className="text-muted">{Math.round((now - start) / 1000)} s</span></p>
        </div>
      </div>
      <Stepper statuses={statuses} trace={trace} />
      <p className="text-sm text-muted">A full review usually takes under a minute. You can leave this page; the link keeps working.</p>
    </section>
  )
}

function Failed({ trace, statuses, onRerun, onEdit }: { trace: Trace; statuses: StepStatus[]; onRerun: () => void; onEdit: () => void }) {
  const f = friendlyError(trace.error ?? '')
  return (
    <section className="card space-y-5 p-6">
      <div>
        <h1 className="text-xl font-semibold text-bad">{f.title}</h1>
        <p className="mt-1 text-sm text-soft">{f.hint}</p>
        {trace.error && <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer">Technical details</summary><pre className="mt-2 whitespace-pre-wrap rounded-lg bg-sunken p-3">{trace.error}</pre></details>}
      </div>
      <Stepper statuses={statuses} trace={trace} />
      <div className="flex gap-2">
        <button className="btn-primary" onClick={onRerun}>Try again</button>
        <button className="btn" onClick={onEdit}>Edit packet</button>
      </div>
    </section>
  )
}

function Hero({ r, trace, fixture, lex, onRerun, onEdit }: { r: Result; trace: Trace; fixture?: Fixture; lex: Lex; onRerun: () => void; onEdit: () => void }) {
  const svc = r.requested_service
  const expected = fixture?.expected.recommendation
  const who = trace.case_id.startsWith('SYN-') ? 'author’s' : 'workbook'
  return (
    <section className="card space-y-5 p-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="eyebrow">Requested service</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{svc.description || '—'}</h1>
          <div className="mt-0.5 text-sm text-muted">{[svc.site_of_care, ...(svc.codes ?? [])].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={printReport}>Print / PDF</button>
          <button type="button" className="btn" onClick={() => downloadReportJson(trace)}>Download JSON</button>
          <MoreMenu onRerun={onRerun} onEdit={onEdit} />
        </div>
      </div>
      <Rail rec={r.recommendation} />
      <div>
        <p className="text-base font-medium"><Humane text={r.bottom_line || trace.decision?.bottom_line || CATEGORY[r.necessity_category] || r.necessity_category} lex={lex} crit /></p>
        {trace.decision?.explanation && <p className="mt-1 text-sm text-soft"><Humane text={trace.decision.explanation} lex={lex} crit /></p>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {expected && (expected === r.recommendation
          ? <span className="inline-flex items-center gap-1.5 text-sm text-ok"><Glyph kind="check" />Matches the {who} label</span>
          : <span className="inline-flex items-center gap-1.5 text-sm text-bad"><Glyph kind="x" />The {who} label is <Verdict rec={expected} /></span>)}
      </div>
      <ReviewerFeedback r={r} />
    </section>
  )
}

function MoreMenu({ onRerun, onEdit }: { onRerun: () => void; onEdit: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const [copied, setCopied] = useState(false)
  const act = (f: () => void) => () => { f(); if (ref.current) ref.current.open = false }
  const items: [string, () => void][] = [
    ['Run again live', onRerun],
    ['Edit packet and re-run', onEdit],
    [copied ? 'Link copied' : 'Copy link', () => { navigator.clipboard.writeText(location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) }],
  ]
  return (
    <details ref={ref} className="relative">
      <summary className="btn cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label="More actions">⋯ More</summary>
      <div className="absolute right-0 z-10 mt-1 w-60 rounded-lg border border-line bg-surface p-1 shadow-lg">
        {items.map(([l, f]) => <button key={l} onClick={act(f)} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-sunken">{l}</button>)}
      </div>
    </details>
  )
}

function Body({ r, trace, facts, statuses, tab, setTab, show, docName, lex }: {
  r: Result; trace: Trace; facts: Fact[]; statuses: StepStatus[]; tab: Tab; setTab: (t: Tab) => void; show: Show; docName: (id: string) => string; lex: Lex
}) {
  const criteria = r.criteria_assessment ?? []
  const met = criteria.filter(c => c.status === 'MET').length
  const qs = r.provider_queries ?? []
  const conflicts = r.contradictions?.length ?? 0
  const count = (n: number, cls: string) => <span className={`rounded-full px-1.5 text-xs font-semibold ${cls}`}>{n}</span>
  return (
    <section>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          ['rules', <>Policy rules <span className="text-xs font-normal text-muted">{met} of {criteria.length} satisfied</span></>],
          ['facts', <>Fact sheet <span className="text-xs font-normal text-muted">{facts.filter(f => f.status !== 'MISSING' && f.aspect !== 'Contradictory documentation flags').length} found</span></>],
          ['ask', <>Ask the provider {qs.length > 0 && count(qs.length, 'bg-warn-soft text-warn')}</>],
          ['summary', <>Case summary {conflicts > 0 && <span className="inline-flex items-center gap-1 text-xs font-semibold text-conflict"><Glyph kind="swap" className="h-3 w-3" />{conflicts}</span>}</>],
          ['how', 'How it decided'],
        ]}
        right={<button className="btn" onClick={show.docs}>Documents ({trace.request.documents.length})</button>}
      />
      <div className="pt-6" role="tabpanel">
        {tab === 'rules' && <RulesTab r={r} show={show} lex={lex} />}
        {tab === 'facts' && <div className="space-y-3 text-sm text-soft"><FactsBody facts={facts} docName={docName} showFact={show.fact} /></div>}
        {tab === 'ask' && <AskTab r={r} lex={lex} />}
        {tab === 'summary' && <SummaryTab r={r} show={show} lex={lex} />}
        {tab === 'how' && <HowTab trace={trace} facts={facts} statuses={statuses} show={show} docName={docName} setTab={setTab} lex={lex} />}
      </div>
    </section>
  )
}

function Quote({ e, lex, onClick }: { e: Evidence; lex: Lex; onClick: () => void }) {
  const date = fmtDate(lex.doc[e.doc_id]?.date)
  return (
    <button onClick={onClick} title="Show in the source document" className="block w-full border-l-2 border-line py-0.5 pl-3 text-left text-sm text-soft transition hover:border-accent hover:text-ink">
      “{e.snippet}” <span className="whitespace-nowrap text-muted">— {e.source_doc}{date && `, ${date}`}</span>
    </button>
  )
}

function RulesTab({ r, show, lex }: { r: Result; show: Show; lex: Lex }) {
  const criteria = [...(r.criteria_assessment ?? [])].sort((a, b) => (SORT[a.status] ?? 2) - (SORT[b.status] ?? 2))
  const missing = r.missing_information ?? []
  const queries = r.provider_queries ?? []
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const orphan = missing.filter(m => !criteria.some(c => hits(m.affects_criterion, c.criterion_id)))
  if (!criteria.length) return <p className="text-sm text-muted">No policy rules could be assessed for this packet.</p>
  return (
    <div className="space-y-6">
      <ul className="card divide-y divide-line overflow-hidden">
        {criteria.map(c => (
          <RuleRow key={c.criterion_id} c={c} n={(r.criteria_assessment ?? []).indexOf(c) + 1} lex={lex} open={open[c.criterion_id] ?? c.status !== 'MET'} toggle={() => setOpen(o => ({ ...o, [c.criterion_id]: !(o[c.criterion_id] ?? c.status !== 'MET') }))}
            missing={missing.filter(m => hits(m.affects_criterion, c.criterion_id))} queries={queries.filter(q => hits(q.criterion_id, c.criterion_id))} show={show} />
        ))}
      </ul>
      {orphan.length > 0 && (
        <div>
          <h3 className="eyebrow mb-2">Also missing from the packet</h3>
          <ul className="space-y-1.5 text-sm">{orphan.map((m, i) => <li key={i}><span className="font-semibold text-warn">Missing</span> <Humane text={m.item} lex={lex} />. <span className="text-muted"><Humane text={m.why_it_matters} lex={lex} /></span></li>)}</ul>
        </div>
      )}
      <p className="text-sm text-muted">Judged against: {r.policy_used || 'no policy supplied (learned patterns only)'}</p>
    </div>
  )
}

function RuleRow({ c, n, lex, open, toggle, missing, queries, show }: {
  c: CriterionResult; n: number; lex: Lex; open: boolean; toggle: () => void; missing: NonNullable<Result['missing_information']>; queries: NonNullable<Result['provider_queries']>; show: Show
}) {
  const [all, setAll] = useState(false)
  const s = STATUS[c.status]
  const quotes = all ? c.evidence : c.evidence.slice(0, 2)
  return (
    <li>
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-sunken/60">
        <StatusDot status={c.status} />
        <span className="min-w-0 flex-1 pt-0.5" title={c.criterion_id}>
          <span className="block text-xs text-muted">Requirement {n}</span>
          <span className="font-medium">{shortLabel(c)}</span>
          {!c.core && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal text-muted">paperwork item</span>}
          {c.any_of_group && <span className="ml-2 rounded bg-sunken px-1.5 py-0.5 text-xs font-normal text-muted">one of several options; any one qualifies</span>}
          {norm(c.criterion_text) !== norm(shortLabel(c)) && <span className="mt-0.5 block text-sm font-normal text-muted">{c.criterion_text}</span>}
        </span>
        <span className={`hidden shrink-0 pt-1 text-sm font-medium sm:block ${s ? TEXT[s.tone] : 'text-muted'}`}>{s?.label ?? c.status}</span>
        <span className={`shrink-0 pt-0.5 text-muted transition ${open ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="space-y-3 pb-5 pl-5 pr-5 text-sm sm:pl-[4.25rem]">
          <p className="leading-6 text-soft"><Humane text={c.reasoning} lex={lex} onFact={show.fact} onDoc={show.doc} /></p>
          {c.evidence.length > 0 ? (
            <div className="space-y-1.5">
              {quotes.map((e, i) => <Quote key={i} e={e} lex={lex} onClick={() => show.quote(e)} />)}
              <div className="flex gap-4 pt-1 text-xs">
                {c.evidence.length > 2 && <button className="link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `+${c.evidence.length - 2} more quotes`}</button>}
                {c.evidence.length > 1 && <button className="link" onClick={() => show.all(c.evidence)}>Highlight all in documents</button>}
              </div>
            </div>
          ) : <p className="italic text-muted">No supporting quote in the packet.</p>}
          {missing.map((m, i) => <p key={i}><span className="font-semibold text-warn">Missing</span> <Humane text={m.item} lex={lex} />. <span className="text-muted"><Humane text={m.why_it_matters} lex={lex} /></span></p>)}
          {queries.map((q, i) => <p key={i}><span className="font-semibold text-accent">Ask</span> <span className="text-soft"><Humane text={q.question} lex={lex} /></span></p>)}
        </div>
      )}
    </li>
  )
}

function AskTab({ r, lex }: { r: Result; lex: Lex }) {
  const qs = r.provider_queries ?? []
  const [copied, setCopied] = useState(false)
  const message = () => [
    'Hello,',
    '',
    `To complete the prior-authorization review for ${r.requested_service.description || `case ${r.case_id}`}, please send the following:`,
    '',
    ...qs.flatMap((q, i) => [`${i + 1}. ${plain(q.question, lex)}`, `   Document needed: ${plain(q.requested_document, lex)}`, ...(lex.crit[q.criterion_id] ? [`   This supports: ${lex.crit[q.criterion_id]}`] : [])]),
    '',
    'Thank you.',
  ].join('\n')
  return (
    <div className="space-y-6">
      {qs.length === 0 ? (
        <div className="card flex items-center gap-3 p-5 text-sm"><StatusDot status="MET" />Nothing is missing. No questions needed.</div>
      ) : (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3">
            <h2 className="flex-1 font-semibold">{qs.length} question{qs.length === 1 ? '' : 's'} for the provider</h2>
            <button className="btn" onClick={() => { navigator.clipboard.writeText(message()); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>{copied ? 'Copied' : 'Copy all as message'}</button>
          </div>
          <ol className="divide-y divide-line">
            {qs.map((q, i) => (
              <li key={i} className="flex gap-4 px-5 py-4">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sunken font-mono text-xs font-semibold text-soft">{i + 1}</span>
                <div className="min-w-0 space-y-1">
                  <p className="text-base leading-6"><Humane text={q.question} lex={lex} /></p>
                  <p className="text-sm text-muted">{lex.crit[q.criterion_id] && <><span title={q.criterion_id}>For: <b className="font-medium text-soft">{lex.crit[q.criterion_id]}</b></span> · </>}Needs: <Humane text={q.requested_document} lex={lex} /></p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
      {r.appeal_direction && (
        <section className="rounded-xl bg-accent-soft p-5">
          <h2 className="mb-1 font-semibold text-accent">What would change the outcome</h2>
          <p className="max-w-[70ch] leading-6 text-soft"><Humane text={r.appeal_direction} lex={lex} /></p>
        </section>
      )}
    </div>
  )
}

function SummaryTab({ r, show, lex }: { r: Result; show: Show; lex: Lex }) {
  return (
    <div className="space-y-8">
      <p className="max-w-[70ch] text-base leading-7"><Humane text={r.clinical_summary} lex={lex} onFact={show.fact} onDoc={show.doc} /></p>
      <div className="grid gap-6 sm:grid-cols-2">
        <Factors title="Strengths" items={r.supporting_factors} glyph="check" cls="text-ok" lex={lex} />
        <Factors title="Concerns" items={r.weakening_factors} glyph="x" cls="text-bad" lex={lex} />
      </div>
      {r.contradictions?.length > 0 && (
        <section className="rounded-xl bg-conflict-soft p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-conflict"><Glyph kind="swap" />Where the documents disagree</h2>
          <ul className="space-y-4 text-sm">
            {r.contradictions.map((c, i) => (
              <li key={i} className="space-y-1.5">
                <p className="font-medium"><Humane text={c.issue} lex={lex} /></p>
                <p className="text-soft"><span className="font-semibold">Trusted:</span> <Humane text={c.preferred_source} lex={lex} />. <Humane text={c.why} lex={lex} /></p>
                {(c.evidence ?? []).slice(0, 3).map((e, j) => <Quote key={j} e={e} lex={lex} onClick={() => show.quote(e)} />)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Factors({ title, items, glyph, cls, lex }: { title: string; items: string[] | null; glyph: 'check' | 'x'; cls: string; lex: Lex }) {
  return (
    <section>
      <h2 className={`mb-2 font-semibold ${cls}`}>{title}</h2>
      {(items ?? []).length === 0 ? <p className="text-sm text-muted">Nothing noted.</p> : (
        <ul className="space-y-2 text-sm">
          {items!.map((x, i) => <li key={i} className="flex gap-2 leading-6 text-soft"><Glyph kind={glyph} className={`mt-1 h-3.5 w-3.5 ${cls}`} /><span><Humane text={x.replace(/\s*\((?:[DF]\d+(?:,\s*)?)+\)/g, '')} lex={lex} /></span></li>)}
        </ul>
      )}
    </section>
  )
}

function lean(s: Stage | undefined) {
  if (!s) return null
  const { prompt: _p, raw_output: _r, ...rest } = s
  return rest
}

function HowTab({ trace, facts, statuses, show, docName, setTab, lex }: { trace: Trace; facts: Fact[]; statuses: StepStatus[]; show: Show; docName: (id: string) => string; setTab: (t: Tab) => void; lex: Lex }) {
  const [active, setActive] = useState<StepKey>('decide')
  const [json, setJson] = useState<'off' | 'output' | 'full'>('off')
  useEffect(() => setJson('off'), [active])
  const S = (n: string) => stageOf(trace, n)
  const step = STEPS.find(s => s.key === active)!
  const i = STEPS.indexOf(step)
  const d = trace.decision
  const r = trace.result!
  const docs = trace.request.documents
  const count = (st: string) => facts.filter(f => f.status === st && f.aspect !== 'Contradictory documentation flags').length
  const quoteChecks = S('validate_facts')?.validations.filter(v => v.check === 'quote_in_source') ?? []
  const factFails = S('validate_facts')?.validations.filter(v => !v.passed) ?? []
  const asmChecks = S('validate_assessment')?.validations ?? []
  const asmFails = asmChecks.filter(v => !v.passed)
  const criteria = r.criteria_assessment ?? []
  const qs = r.provider_queries ?? []

  const detail: Record<StepKey, { summary: ReactNode; body: ReactNode; output: () => any; full: () => any }> = {
    ingest: {
      summary: <>{docs.length} documents{trace.request.policy ? <>, judged against <b>{trace.request.policy.name}</b></> : <>, <span className="text-warn">no payer policy supplied</span></>}</>,
      body: (
        <>
          <p>Every document is registered so each fact and quote can point back to exactly where it came from.</p>
          <div className="flex flex-wrap gap-2">
            {docs.map(x => (
              <button key={x.doc_id} title={x.doc_id} onClick={() => show.doc(x.doc_id!)} className="rounded-lg border border-line px-2.5 py-1.5 text-left text-sm transition hover:border-accent">
                <span className="font-medium text-ink">{x.name}</span>{x.date && <span className="text-muted"> · {fmtDate(x.date)}</span>}
              </button>
            ))}
          </div>
          {!trace.request.policy && <p className="text-warn">Without a policy, PolicyLens falls back to patterns learned from past cases and marks the result as low confidence.</p>}
        </>
      ),
      output: () => lean(S('ingest')), full: () => S('ingest'),
    },
    extract: {
      summary: <><b className="text-ok">{count('FOUND')}</b> facts found · <b>{count('MISSING')}</b> not in the packet{count('CONFLICT') > 0 && <> · <b className="text-conflict">{count('CONFLICT')}</b> where sources disagree</>}</>,
      body: <FactsBody facts={facts} docName={docName} showFact={show.fact} />,
      output: () => S('validate_facts')?.parsed, full: () => S('extract'),
    },
    quotes: {
      summary: factFails.length === 0
        ? <><b className="text-ok">{quoteChecks.length}/{quoteChecks.length}</b> quotes found exactly in the documents</>
        : <><b>{quoteChecks.filter(v => v.passed).length}/{quoteChecks.length}</b> quotes verified · <span className="text-warn">{factFails.length} problem(s) caught and corrected</span></>,
      body: (
        <>
          <p>The AI is not trusted on its word. If a quote cannot be found in the document it claims to come from, the quote is thrown away, and a fact left without proof is marked “not in packet”.</p>
          {factFails.length > 0
            ? <ul className="space-y-1">{factFails.map((v, k) => <li key={k} className="text-warn" title={v.target}><Humane text={v.target.replace('/', ' in ')} lex={lex} /> · {v.detail}</li>)}</ul>
            : <p className="text-ok">No invented or misquoted text found.</p>}
        </>
      ),
      output: () => ({ validations: S('validate_facts')?.validations, summary: S('validate_facts')?.input_summary }), full: () => S('validate_facts'),
    },
    assess: {
      summary: <>{criteria.filter(c => c.status === 'MET').length} of {criteria.length} policy requirements satisfied</>,
      body: (
        <>
          <p>The policy is split into separate rules. For each one the AI must first cite evidence, then explain, then decide.</p>
          <div className="flex flex-wrap gap-2">{criteria.map(c => <span key={c.criterion_id} title={c.criterion_id} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1"><span className="text-sm">{shortLabel(c)}</span><Badge status={c.status} /></span>)}</div>
          <button className="link" onClick={() => setTab('rules')}>See every rule with its evidence →</button>
        </>
      ),
      output: () => S('validate_assessment')?.parsed, full: () => S('assess'),
    },
    guard: {
      summary: asmFails.length === 0
        ? <><b className="text-ok">{asmChecks.length}/{asmChecks.length}</b> checks passed, no corrections needed</>
        : <><b>{asmChecks.length - asmFails.length}/{asmChecks.length}</b> passed · <span className="text-warn">{asmFails.length} correction(s) applied</span></>,
      body: (
        <>
          <ul className="grid gap-2 sm:grid-cols-2">
            {[
              ['A “met” or “not met” verdict must cite real, verified evidence.', 'MET/UNMET need a FOUND/CONFLICT fact, else NOT_ASSESSABLE'],
              ['A missing note can never be used to deny. That is a paperwork gap.', 'UNMET resting only on missing records → NOT_ASSESSABLE'],
              ['If the packet itself says something is missing, it cannot count as met.', 'MET citing its own reported gap → PARTIALLY_MET'],
              ['Requirements nobody asked for cannot block a case.', 'No policy + no evidence + core → non-core'],
            ].map(([a, b]) => <li key={a} className="rounded-lg bg-sunken px-3 py-2"><span className="block">{a}</span><code className="mt-1 block font-mono text-xs text-muted">{b}</code></li>)}
          </ul>
          {asmFails.length > 0 && <ul className="space-y-1">{asmFails.map((v, k) => <li key={k} className="text-warn" title={v.target}><b className="font-medium"><Humane text={v.target.replace('/', ' citing ')} lex={lex} crit /></b> · <Humane text={v.detail} lex={lex} /></li>)}</ul>}
        </>
      ),
      output: () => ({ validations: asmChecks, retries: S('assess')?.retries }), full: () => S('validate_assessment'),
    },
    decide: {
      summary: <Humane text={d?.explanation} lex={lex} crit />,
      body: d && <DecisionBody d={d} />,
      output: () => ({ input: S('decide')?.input_summary, output: d }), full: () => S('decide'),
    },
    queries: {
      summary: S('queries')?.skipped ? 'Nothing is missing, so no questions are needed' : <>{qs.length} targeted question{qs.length === 1 ? '' : 's'} and how to strengthen the case</>,
      body: (
        <>
          <p>Code picks out the gaps first, then the AI writes one specific question per gap, naming the document needed and the rule it would satisfy.</p>
          <button className="link" onClick={() => setTab('ask')}>See the questions →</button>
        </>
      ),
      output: () => ({ provider_queries: r.provider_queries, missing_information: r.missing_information, appeal_direction: r.appeal_direction }), full: () => S('queries'),
    },
    result: {
      summary: <span className="inline-flex flex-wrap items-center gap-2"><Verdict rec={r.recommendation} /> · {CATEGORY_SHORT[r.necessity_category] ?? r.necessity_category} · {WORKFLOW[r.workflow_state] ?? r.workflow_state}</span>,
      body: <p>Everything above is packaged into the output contract returned by <code className="font-mono text-xs">POST /v1/assess</code>.</p>,
      output: () => r, full: () => trace,
    },
  }
  const cur = detail[active]
  const stage = S(step.stages[0])

  return (
    <div className="space-y-6">
      <Stepper statuses={statuses} trace={trace} active={active} onPick={setActive} />
      <section className="card p-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="font-mono">Step {i + 1} of {STEPS.length}</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${step.ai ? 'bg-accent-soft text-accent' : 'bg-sunken text-soft'}`}>{step.ai ? 'AI step' : 'Code check'}</span>
          {stage?.duration_ms != null && <span>{ms(stage.duration_ms)}</span>}
          <code className="ml-auto hidden font-mono sm:block">{step.code}</code>
        </div>
        <h2 className="mt-2 text-lg font-semibold">{step.title}</h2>
        <p className="mt-0.5 text-sm text-soft">{cur.summary}</p>
        <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm text-soft">{cur.body}</div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="btn font-mono" aria-pressed={json === 'output'} onClick={() => setJson(json === 'output' ? 'off' : 'output')}>{'{ }'} Output JSON</button>
          {active !== 'result' && <button className="btn font-mono" aria-pressed={json === 'full'} onClick={() => setJson(json === 'full' ? 'off' : 'full')}>Prompt + raw AI output</button>}
        </div>
        {json !== 'off' && <div className="mt-3"><JsonPanel name={`step-${active}-${json}`} value={json === 'output' ? cur.output() : cur.full()} /></div>}
      </section>
      <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted">
        <span>trace {trace.trace_id}</span><span>skill {trace.skill_version}</span><span>{trace.provider}/{trace.model}</span>
      </p>
    </div>
  )
}

function FactsBody({ facts, docName, showFact }: { facts: Fact[]; docName: (id: string) => string; showFact: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const sorted = [...facts].sort((a, b) => +a.fact_id.slice(1) - +b.fact_id.slice(1))
  const shown = sorted.filter(f => all || f.status !== 'MISSING')
  const missing = sorted.filter(f => f.status === 'MISSING')
  return (
    <>
      <p>The AI fills a reviewer’s checklist (diagnosis, test results, treatments tried…), plus any measurement the payer policy depends on. Each fact must quote the document it came from. Click a row to see the quote.</p>
      <div className="overflow-hidden rounded-lg border border-line">
        {shown.map(f => (
          <button key={f.fact_id} title={f.fact_id} onClick={() => showFact(f.fact_id)} className="grid w-full grid-cols-1 items-start gap-x-3 gap-y-1 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-sunken sm:grid-cols-[12rem_minmax(0,1fr)]">
            <span className="font-medium text-ink">{f.aspect}<span className="mt-1 block"><Badge status={f.status} /></span></span>
            <span>{f.value || '—'}{(f.sources ?? []).length > 0 && <span className="mt-0.5 block text-xs text-muted">from {[...new Set((f.sources ?? []).map(s => docName(s.doc_id)))].join(', ')}</span>}</span>
          </button>
        ))}
      </div>
      {missing.length > 0 && !all && <p className="text-muted">Not in packet: {missing.map(f => f.aspect).join(', ')}. <button className="link" onClick={() => setAll(true)}>Show as rows</button></p>}
    </>
  )
}

function DecisionBody({ d }: { d: NonNullable<Trace['decision']> }) {
  const fired = RULES.findIndex(x => x.id === d.rule_fired)
  return (
    <>
      <p>No AI here. The rules are checked in order and the first one that fits decides. That is how a missing document leads to “needs more info” and never to a denial.</p>
      <ol className="space-y-1.5">
        {RULES.map((x, k) => (
          <li key={x.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 ${k === fired ? 'bg-accent-soft ring-1 ring-accent' : k < fired ? 'text-muted line-through decoration-muted/50' : 'text-muted'}`}>
            <span className="font-mono text-xs">{k + 1}.</span>
            <span className="min-w-0 flex-1">{x.when} <code className="font-mono text-xs text-muted">{x.id}</code></span>
            <Verdict rec={x.then} short />
            {k === fired && <span className="text-xs font-semibold text-accent">fired</span>}
          </li>
        ))}
      </ol>
    </>
  )
}

function Drawer({ docs, policy, marks, lex, onClose }: { docs: Trace['request']['documents']; policy?: { name: string; text: string }; marks: Mark[]; lex: Lex; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const done = useRef(onClose)
  done.current = onClose
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    document.documentElement.dataset.drawer = 'open'
    close.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') done.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); delete document.documentElement.dataset.drawer; back?.focus?.() }
  }, [])
  useEffect(() => {
    const el = box.current?.querySelector('mark') as HTMLElement | null
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - 96, behavior: 'smooth' })
  }, [marks])
  return (
    <>
      <div className="no-print fixed inset-0 z-30 bg-ink/20 min-[1440px]:hidden" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-label="Source documents" className="no-print fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-line bg-canvas shadow-2xl sm:w-[520px] min-[1440px]:shadow-none">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
          <h2 className="flex-1 font-semibold">Source documents</h2>
          <button ref={close} className="btn" onClick={onClose}>Close <span className="text-xs text-muted">Esc</span></button>
        </div>
        <div ref={box} className="relative flex-1 space-y-3 overflow-auto p-4">
          {marks.length === 0 && <p className="rounded-lg border border-dashed border-line p-3 text-sm text-muted">Click any quote on the result to highlight the exact sentence it came from.</p>}
          {docs.map(d => {
            const own = marks.filter(m => m.doc_id === d.doc_id).sort((a, b) => a.span[0] - b.span[0])
            const parts: ReactNode[] = []
            let at = 0
            for (const m of own) {
              const s = Math.max(m.span[0], at)
              if (m.span[1] <= s) continue
              parts.push(d.text.slice(at, s))
              parts.push(<mark key={s} className="rounded bg-hl px-0.5 text-ink">{d.text.slice(s, m.span[1])}</mark>)
              at = m.span[1]
            }
            parts.push(d.text.slice(at))
            return (
              <article key={d.doc_id} className={`rounded-xl border bg-surface p-4 ${own.length ? 'border-hl' : 'border-line'}`}>
                <h3 className="mb-2 text-sm" title={d.doc_id}>
                  <span className="font-medium">{d.name}</span>
                  <span className="block text-xs text-muted">{[prettyType(d.type), fmtDate(d.date), daysBefore(d.date, lex.requestDate)].filter(Boolean).join(' · ')}</span>
                </h3>
                <div className="whitespace-pre-wrap text-sm leading-6">{parts}</div>
              </article>
            )
          })}
          {policy && (
            <article className="rounded-xl border border-accent/30 bg-accent-soft p-4">
              <h3 className="mb-2 text-sm font-semibold text-accent">Payer policy · {policy.name}</h3>
              <div className="whitespace-pre-wrap text-sm leading-6">{policy.text}</div>
            </article>
          )}
        </div>
      </aside>
    </>
  )
}


function ReviewerFeedback({ r }: { r: Result }) {
  const [mode, setMode] = useState<'ask' | 'override' | 'sent'>('ask')
  const [label, setLabel] = useState(VERDICT_ORDER.find(v => v !== r.recommendation)!)
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const send = async (correct: string, why: string) => {
    setErr('')
    try { await api.feedback({ trace_id: r.trace_id, correct_label: correct, reason: why }); setMode('sent') } catch (e) { setErr(String(e)) }
  }
  if (mode === 'sent') return <p className="flex items-center gap-2 border-t border-line pt-4 text-sm text-ok"><Glyph kind="check" />Thanks. Your review was recorded and will be used to improve the rules.</p>
  return (
    <div className="space-y-3 border-t border-line pt-4 text-sm">
      {mode === 'ask' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">Do you agree with this recommendation?</span>
          <button className="btn" onClick={() => send(r.recommendation, 'agree')}>Agree</button>
          <button className="btn" onClick={() => setMode('override')}>Override…</button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">The right outcome is</span>
            {VERDICT_ORDER.filter(v => v !== r.recommendation).map(v => (
              <button key={v} className="chip" aria-pressed={label === v} onClick={() => setLabel(v)}>{VERDICT[v].label}</button>
            ))}
          </div>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Why? For example: the 10/19 addendum was missed." rows={2}
            className="w-full rounded-lg border border-line bg-surface p-2.5 text-sm focus:border-accent focus:outline-none" />
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!reason.trim()} onClick={() => send(label, reason.trim())}>Submit override</button>
            <button className="btn" onClick={() => setMode('ask')}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="text-bad">{err}</p>}
    </div>
  )
}
