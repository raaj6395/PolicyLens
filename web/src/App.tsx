import { useEffect, useState, type ReactNode } from 'react'
import { marked } from 'marked'
import { api, type Fixture, type Req, type RunSummary, type Trace } from './api'
import { Intake } from './Intake'
import { RunView } from './Run'
import { RULES, Spinner, VERDICT_ORDER, Verdict, caseTitle, friendlyError, go, read, useRoute, write } from './ui'

const strip = (r: Req): Req => ({ ...r, documents: r.documents.map(({ doc_id: _d, ...d }) => d) })

export default function App() {
  const route = useRoute()
  const [cases, setCases] = useState<Fixture[]>([])
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Req>()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.cases().then(setCases).catch(e => setErr(String(e)))
    for (const m of ['loo', 'synthetic']) api.evalReport(m).then(r => setSaved(x => ({
      ...x,
      ...Object.fromEntries(r.cases.map(c => [c.case_id, c.trace_id])),
    }))).catch(() => {})
  }, [])
  useEffect(() => setErr(''), [route.join('/')])

  const start = async (p: Promise<{ trace_id: string }>) => {
    setErr('')
    setBusy(true)
    try { go(`r/${(await p).trace_id}`) } catch (e) { setErr(String(e)) } finally { setBusy(false) }
  }
  const open = (c: Fixture) => saved[c.request.case_id] ? go(`r/${saved[c.request.case_id]}`) : start(api.runCase(c.request.case_id))
  const edit = (r: Req) => { setDraft({ ...strip(r) }); go('new') }

  const [page, id] = route
  const section = page === 'history' ? 'history' : page === 'how' ? 'how' : 'review'

  return (
    <>
      <header className="no-print sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1080px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <a href="#/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink">
              <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M12 9v6M9 12h6" /></svg>
            </span>
            <span className="font-semibold">PolicyLens</span>
          </a>
          <nav className="flex gap-1 text-sm" aria-label="Main">
            {([['review', '#/', 'Review'], ['history', '#/history', 'History'], ['how', '#/how', 'How it works']] as const).map(([k, href, label]) => (
              <a key={k} href={href} aria-current={section === k ? 'page' : undefined}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${section === k ? 'bg-sunken text-ink' : 'text-muted hover:text-ink'}`}>{label}</a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1080px] px-4 py-8">
        {err && <div className="no-print mb-6 rounded-xl bg-bad-soft px-4 py-3 text-sm text-bad" role="alert"><b>{friendlyError(err).title}</b> {friendlyError(err).hint}<details className="mt-1 text-xs opacity-80"><summary className="cursor-pointer">Technical details</summary>{err}</details></div>}
        {!page && <Home cases={cases} busy={busy} onOpen={open} />}
        {page === 'new' && <Intake cases={cases} busy={busy} initial={draft} onRun={r => start(api.assess(r))} />}
        {page === 'r' && id && <ResultPage traceId={id} cases={cases} onRerun={t => start(cases.some(c => c.request.case_id === t.case_id) ? api.runCase(t.case_id) : api.assess(strip(t.request)))} onEdit={t => edit(t.request)} />}
        {page === 'history' && <History />}
        {page === 'how' && <How />}
      </main>
    </>
  )
}

function ResultPage({ traceId, cases, onRerun, onEdit }: { traceId: string; cases: Fixture[]; onRerun: (t: Trace) => void; onEdit: (t: Trace) => void }) {
  const [trace, setTrace] = useState<Trace | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let stop = false
    setTrace(null)
    setErr('')
    const tick = async () => {
      try {
        const t = await api.trace(traceId)
        if (stop) return
        setTrace(t)
        if (t.status === 'running') setTimeout(tick, 1200)
      } catch (e) { if (!stop) setErr(String(e)) }
    }
    tick()
    return () => { stop = true }
  }, [traceId])
  if (err) return (
    <div className="mx-auto max-w-[760px] space-y-3">
      <h1 className="text-xl font-semibold">This result is not available</h1>
      <p className="text-soft">The trace may have expired after a server restart. {err}</p>
      <a href="#/" className="link">← Back to all cases</a>
    </div>
  )
  if (!trace) return <Spinner label="Loading result…" />
  return <RunView trace={trace} fixture={cases.find(c => c.request.case_id === trace.case_id)} onRerun={() => onRerun(trace)} onEdit={() => onEdit(trace)} />
}

function Home({ cases, busy, onOpen }: { cases: Fixture[]; busy: boolean; onOpen: (c: Fixture) => void }) {
  const featured = cases.find(c => c.request.case_id === 'PA-001') ?? cases[0]
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  useEffect(() => { api.history().then(setRuns).catch(() => setRuns([])) }, [])
  const steps = [
    ['Read', 'Pulls the facts out of messy notes and checks every quote word-for-word.'],
    ['Check each rule', 'Marks every payer requirement as satisfied, partly shown, not satisfied, or no information.'],
    ['Decide', 'Fixed rules turn those checks into a verdict. A missing note is never a denial.'],
    ['Explain', 'Shows the evidence for every claim and drafts the questions for the doctor.'],
  ]
  const outcomes: Record<string, string> = {
    LIKELY_APPROVE: 'Every core rule is met and backed by a quote.',
    NEED_MORE_INFO: 'Plausible, but a document is missing. Names exactly what to send.',
    LIKELY_DENY: 'The packet itself shows a core rule is not met.',
  }
  return (
    <div className="space-y-12">
      <section className="card relative overflow-hidden p-6 sm:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-soft blur-3xl" aria-hidden="true" />
        <div className="relative grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Pre-auth review in minutes, with a quote for every claim.</h1>
            <p className="max-w-xl text-base leading-7 text-soft">PolicyLens reads the packet, checks it against the payer policy, and tells a paperwork gap apart from a real denial.</p>
            <div className="flex flex-wrap gap-3 pt-2">
              <a href="#/new" className="btn-primary px-5 py-2.5 text-base">Review your own packet →</a>
              <button className="btn px-5 py-2.5 text-base" disabled={!featured || busy} onClick={() => featured && onOpen(featured)}>See an example</button>
            </div>
            {featured && <p className="text-sm text-muted">Example: {caseTitle(featured.title)}, {featured.request.documents.length} documents.</p>}
          </div>
          <div className="rounded-xl border border-line bg-surface/80 p-4">
            <h2 className="eyebrow mb-3">Every review ends in one of</h2>
            <ul className="space-y-3">
              {VERDICT_ORDER.map(k => (
                <li key={k} className="space-y-1">
                  <Verdict rec={k} />
                  <p className="text-sm leading-5 text-soft">{outcomes[k]}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">How it works</h2>
          <a href="#/how" className="link text-sm">Full details →</a>
        </div>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([t, d], i) => (
            <li key={t} className="card p-4">
              <div className="flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft font-mono text-xs text-accent">{i + 1}</span>{t}</div>
              <p className="mt-2 text-sm leading-6 text-soft">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {!!runs?.length && (
        <section>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold">Recent runs</h2>
            <a href="#/history" className="link text-sm">View all {runs.length} →</a>
          </div>
          <RunList runs={runs.slice(0, 3)} />
        </section>
      )}
    </div>
  )
}

function History() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.history().then(setRuns).catch(e => setErr(String(e))) }, [])
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-soft">Every review run on this server, newest first.</p>
      </div>
      {err && <p className="text-sm text-bad">{err}</p>}
      {!runs && !err && <Spinner label="Loading history…" />}
      {runs && !runs.length && <p className="text-sm text-muted">No runs yet. <a href="#/new" className="link">Review a packet</a> to get started.</p>}
      {!!runs?.length && <RunList runs={runs} />}
    </div>
  )
}

function RunList({ runs }: { runs: RunSummary[] }) {
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {runs.map(r => (
        <li key={r.trace_id}>
          <a href={`#/r/${r.trace_id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-5 py-3.5 transition hover:bg-sunken/60 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_5rem]">
            <span className="font-mono text-xs text-muted">{new Date(r.created_at).toLocaleString()}</span>
            <span className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
              <span className="block font-mono text-xs text-muted">{r.case_id}</span>
              <span className="block truncate font-medium">{r.service || (r.status === 'error' ? r.error : 'In progress…')}</span>
            </span>
            <span className="row-span-2 sm:row-span-1">{r.recommendation ? <Verdict rec={r.recommendation} short /> : <span className={`text-sm ${r.status === 'error' ? 'text-bad' : 'text-muted'}`}>{r.status}</span>}</span>
            <span className="hidden text-right text-sm text-muted sm:block">{r.confidence?.toLowerCase()}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

const TOC = [['steps', 'The four steps'], ['outcomes', 'Three outcomes'], ['rules', 'Decision rules'], ['rulebook', 'Rulebook'], ['examples', 'Examples and schemas'], ['api', 'API']] as const

function How() {
  const [s, setS] = useState<any>(null)
  const [key, setKey] = useState(read('apiKey') || '')
  useEffect(() => { api.skill().then(setS).catch(() => setS(false)) }, [])
  const outcomes: Record<string, [string, string]> = {
    LIKELY_APPROVE: ['Supported and well documented.', 'Every core rule of the policy is met, and each one is backed by a verified quote from the packet.'],
    NEED_MORE_INFO: ['Plausible, but documentation is incomplete.', 'The request looks clinically reasonable, but some proof is missing or unclear. PolicyLens names the exact document needed. This is never treated as a denial.'],
    LIKELY_DENY: ['Not medically necessary under the policy.', 'The packet itself shows that a core rule of the policy is not met. A missing note alone can never produce this outcome.'],
  }
  const origin = location.origin
  return (
    <div className="grid gap-10 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <nav className="hidden lg:block" aria-label="On this page">
        <ul className="sticky top-24 space-y-1 text-sm">
          {TOC.map(([k, l]) => <li key={k}><a href={`#/how`} onClick={e => { e.preventDefault(); document.getElementById(k)?.scrollIntoView({ behavior: 'smooth' }) }} className="block rounded-md px-2 py-1 text-muted hover:bg-sunken hover:text-ink">{l}</a></li>)}
        </ul>
      </nav>
      <div className="min-w-0 space-y-14">
        <Block id="steps" title="The four steps">
          <ol className="grid gap-3 sm:grid-cols-2">
            {[
              ['Read', 'AI', 'Pulls out the facts a reviewer needs (diagnosis, test results, treatments tried…). Each fact must quote the document it came from, and code checks every quote word-for-word. A fact without proof is marked “not in packet”.'],
              ['Check each rule', 'AI + code', 'The payer policy is split into separate rules. For each one the AI cites evidence, then explains, then decides. Code guardrails stop a missing note from being used to deny.'],
              ['Decide', 'Code', 'A fixed list of rules turns the checks into a verdict and a confidence score. No AI is involved, so the same checks always give the same verdict.'],
              ['Explain', 'AI', 'Drafts one specific question per gap, naming the document needed and the rule it would satisfy, plus what would change the outcome.'],
            ].map(([t, who, d], i) => (
              <li key={t} className="card p-5">
                <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent">{i + 1}</span><span className="flex-1 font-semibold">{t}</span><span className="text-xs text-muted">{who}</span></div>
                <p className="mt-2 text-sm leading-6 text-soft">{d}</p>
              </li>
            ))}
          </ol>
        </Block>

        <Block id="outcomes" title="Three outcomes">
          <div className="grid gap-3 md:grid-cols-3">
            {VERDICT_ORDER.map(k => (
              <div key={k} className="card space-y-2 p-5">
                <Verdict rec={k} />
                <p className="text-sm font-medium">{outcomes[k][0]}</p>
                <p className="text-sm leading-6 text-soft">{outcomes[k][1]}</p>
              </div>
            ))}
          </div>
        </Block>

        <Block id="rules" title="Decision rules" sub="Checked top to bottom. The first rule that fits decides.">
          <ol className="card divide-y divide-line overflow-hidden">
            {RULES.map((x, i) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="font-mono text-xs text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">{x.when}</span>
                <code className="hidden font-mono text-xs text-muted sm:inline">{x.id}</code>
                <Verdict rec={x.then} short />
              </li>
            ))}
          </ol>
        </Block>

        <Block id="rulebook" title="Rulebook" sub={s ? `skill/SKILL.md · version ${s.version}` : undefined}>
          {s === null ? <Spinner label="Loading rulebook…" /> : s === false ? <p className="text-sm text-muted">Could not load the rulebook.</p> : (
            <details className="card p-5">
              <summary className="cursor-pointer font-medium">Read the full rulebook the AI follows</summary>
              <article className="skill-md mt-4" dangerouslySetInnerHTML={{ __html: marked.parse(s.markdown) as string }} />
            </details>
          )}
        </Block>

        {s && (
          <Block id="examples" title="Examples and schemas">
            <div className="grid gap-4 md:grid-cols-2">
              <section className="card p-5">
                <h3 className="mb-2 font-semibold">Few-shot examples ({s.examples.length})</h3>
                {s.examples.map((e: any) => (
                  <details key={e.case_id + (e.criteria ? '-complex' : '')} className="border-t border-line py-2 text-sm first:border-t-0">
                    <summary className="flex cursor-pointer items-center gap-2"><b className="font-mono text-xs">{e.case_id}</b><span className="min-w-0 flex-1 truncate">{e.requested_service}</span><Verdict rec={e.recommendation} short /></summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-3 text-xs">{JSON.stringify(e, null, 2)}</pre>
                  </details>
                ))}
              </section>
              <section className="card p-5">
                <h3 className="mb-2 font-semibold">Output schemas</h3>
                {Object.entries(s.schemas).map(([k, v]) => (
                  <details key={k} className="border-t border-line py-2 text-sm first:border-t-0">
                    <summary className="cursor-pointer font-mono text-xs">{k}.json</summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-code p-3 text-xs text-code-ink">{JSON.stringify(v, null, 2)}</pre>
                  </details>
                ))}
              </section>
            </div>
          </Block>
        )}

        <Block id="api" title="API" sub="The same skill this page uses, callable from your own systems.">
          <div className="card divide-y divide-line overflow-hidden text-sm">
            {[
              ['POST', '/v1/assess', 'Run the skill on a packet. Add ?async=true to get a trace_id back immediately.'],
              ['GET', '/v1/traces', 'Summaries of every past run, newest first.'],
              ['GET', '/v1/traces/{id}', 'Full stage-by-stage trace: prompts, raw AI output, validations, decision.'],
              ['GET', '/v1/cases', 'The bundled sample packets.'],
              ['POST', '/v1/cases/{id}/run', 'Run a bundled sample packet.'],
              ['GET', '/v1/eval?mode=loo', 'Saved accuracy reports (loo, synthetic, insample).'],
              ['GET', '/v1/skill', 'The rulebook, examples and schemas.'],
            ].map(([m, p, d]) => (
              <div key={p + m} className="grid gap-1 px-5 py-3 sm:grid-cols-[4rem_12rem_minmax(0,1fr)]">
                <span className="font-mono text-xs font-semibold text-accent">{m}</span><code className="font-mono text-xs">{p}</code><span className="text-soft">{d}</span>
              </div>
            ))}
          </div>
          <pre className="mt-4 overflow-auto rounded-lg bg-code p-4 text-xs leading-5 text-code-ink">{`curl -X POST ${origin}/v1/assess \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: <key, if the server requires one>' \\
  -d '{"case_id":"MY-1","documents":[{"name":"Consult note","text":"..."}],"policy":{"name":"Policy v1","text":"..."}}'`}</pre>
          <label className="mt-4 block max-w-sm text-sm">
            <span className="mb-1 block font-medium">API key for this browser</span>
            <input value={key} onChange={e => { setKey(e.target.value); write('apiKey', e.target.value) }} placeholder="X-API-Key (only if the server requires one)" className="field" />
            <span className="mt-1 block text-xs text-muted">Sent with live runs from this page. Stored only in this browser.</span>
          </label>
        </Block>
      </div>
    </div>
  )
}

function Block({ id, title, sub, children }: { id: string; title: string; sub?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}
