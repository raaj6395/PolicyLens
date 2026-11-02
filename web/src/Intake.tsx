import { useEffect, useState, type ReactNode } from 'react'
import type { Doc, Fixture, Req } from './api'
import { caseTitle } from './ui'

const TYPES = ['clinical_note', 'h_and_p', 'progress_note', 'medication_history', 'allergies', 'labs', 'imaging', 'procedure_history', 'request_form', 'utilization_review', 'other']
const blank = (): Doc => ({ name: '', type: 'other', date: '', text: '' })

export function Intake({ cases, busy, initial, onRun }: { cases: Fixture[]; busy: boolean; initial?: Req; onRun: (r: Req) => void }) {
  const [caseId, setCaseId] = useState('')
  const [docs, setDocs] = useState<Doc[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [policyName, setPolicyName] = useState('')
  const [policyText, setPolicyText] = useState('')
  const [policyOpen, setPolicyOpen] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState('')

  const req = (): Req => ({
    case_id: caseId.trim() || 'AD-HOC',
    documents: docs.filter(d => d.text.trim()).map(d => ({ name: d.name.trim() || 'Untitled document', type: d.type, ...(d.date ? { date: d.date } : {}), text: d.text })),
    ...(policyText.trim() ? { policy: { name: policyName.trim() || 'Payer policy', text: policyText } } : {}),
  })
  const load = (r: Req) => {
    setCaseId(r.case_id === 'AD-HOC' ? '' : r.case_id.endsWith('-COPY') ? r.case_id : r.case_id + '-COPY')
    setDocs(r.documents.map(d => ({ name: d.name, type: d.type || 'other', date: d.date || '', text: d.text })))
    setPolicyName(r.policy?.name ?? '')
    setPolicyText(r.policy?.text ?? '')
    setEditing(null)
    setErr('')
  }
  useEffect(() => { if (initial) load(initial) }, [initial])

  const set = (i: number, p: Partial<Doc>) => setDocs(ds => ds.map((d, j) => j === i ? { ...d, ...p } : d))
  const remove = (i: number) => { setDocs(ds => ds.filter((_, j) => j !== i)); setEditing(null) }
  const paste = () => { setDocs(ds => [...ds, blank()]); setEditing(docs.length) }
  const upload = async (files: FileList | null) => {
    if (!files) return
    setErr('')
    const added: Doc[] = []
    for (const f of Array.from(files)) {
      const text = await f.text()
      if (f.name.endsWith('.json')) {
        try { const r = JSON.parse(text); if (Array.isArray(r.documents)) { load(r); return } } catch { setErr(`${f.name} is not valid JSON`); return }
      }
      const base = f.name.replace(/\.[^.]+$/, '')
      if (/policy/i.test(base)) {
        const [first, ...rest] = text.split('\n')
        setPolicyName(rest.join('\n').trim() ? first.trim() : base)
        setPolicyText(rest.join('\n').trim() || text)
        continue
      }
      const date = base.match(/^(\d{4}-\d{2}-\d{2})[_ -]*/)
      const name = (date ? base.slice(date[0].length) : base).replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase())
      added.push({ name, type: 'other', date: date?.[1] ?? '', text })
    }
    setDocs(ds => [...ds.filter(d => d.text.trim()), ...added])
    setEditing(null)
  }
  const submit = () => {
    const r = req()
    if (!r.documents.length) return setErr('Add at least one document with text.')
    setErr('')
    onRun(r)
  }
  const filled = docs.filter(d => d.text.trim()).length
  const curl = `curl -X POST ${location.origin}/v1/assess \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(req(), null, 2).replace(/'/g, "'\\''")}'`

  return (
    <div className="mx-auto max-w-[760px] space-y-6">
      <div>
        <a href="#/" className="link text-sm">← All cases</a>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New review</h1>
        <p className="mt-1 text-soft">Add the documents as they arrived and the payer policy. Every judgment in the result will point to the sentence that supports it.</p>
      </div>

      <Section n={1} title="Documents" right={<span className="text-sm text-muted">{filled} added</span>}>
        <label
          onDragOver={e => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}
          className={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${drag ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted'}`}
        >
          <span className="font-medium">Drop files here or <span className="text-accent">browse</span></span>
          <span className="text-sm text-muted">.txt, .md, .csv or a request .json. A file named *policy* fills step 2. A YYYY-MM-DD_ prefix sets the date.</span>
          <input type="file" multiple accept=".txt,.md,.json,.csv" className="sr-only" onChange={e => { upload(e.target.files); e.target.value = '' }} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn" onClick={paste}>+ Paste text instead</button>
          <select className="btn" value="" onChange={e => { const c = cases.find(x => x.request.case_id === e.target.value); if (c) load(c.request) }} aria-label="Load an example packet">
            <option value="">Load an example…</option>
            {cases.map(c => <option key={c.request.case_id} value={c.request.case_id}>{c.request.case_id} · {caseTitle(c.title)}</option>)}
          </select>
        </div>
        {docs.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {docs.map((d, i) => (
              <li key={i}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-xs font-semibold text-accent">Document {i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{d.name || 'Untitled document'}</span>
                    {d.date && <span className="text-muted"> · {d.date}</span>}
                  </span>
                  <span className="hidden text-sm text-muted sm:inline">{d.text.length.toLocaleString()} chars</span>
                  <button className="btn" aria-expanded={editing === i} onClick={() => setEditing(editing === i ? null : i)}>{editing === i ? 'Done' : 'Edit'}</button>
                  <button className="btn" aria-label={`Remove D${i + 1}`} onClick={() => remove(i)}>✕</button>
                </div>
                {editing === i && (
                  <div className="space-y-2 border-t border-line bg-sunken/50 p-4">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_10rem]">
                      <input value={d.name} onChange={e => set(i, { name: e.target.value })} placeholder="Name, e.g. Neurosurgery consult" className="field" aria-label="Document name" />
                      <select value={d.type} onChange={e => set(i, { type: e.target.value })} className="field" aria-label="Document type">
                        {[...new Set([...TYPES, d.type || 'other'])].map(t => <option key={t}>{t}</option>)}
                      </select>
                      <input type="date" value={d.date} onChange={e => set(i, { date: e.target.value })} className="field" aria-label="Document date" />
                    </div>
                    <textarea value={d.text} onChange={e => set(i, { text: e.target.value })} placeholder="Paste the document text exactly as received…" className="field h-48 resize-y leading-6" aria-label="Document text" autoFocus={!d.text} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section n={2} title="Payer policy" right={<button className="link text-sm" aria-expanded={policyOpen} onClick={() => setPolicyOpen(!policyOpen)}>{policyOpen ? 'Collapse' : policyText.trim() ? 'Edit' : 'Add policy'}</button>}>
        {policyText.trim() && !policyOpen && <p className="text-sm"><span className="font-medium">{policyName || 'Payer policy'}</span> <span className="text-muted">· {policyText.length.toLocaleString()} chars</span></p>}
        {!policyText.trim() && <p className="rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">No policy yet. PolicyLens will judge against patterns learned from past cases and cap confidence at Low.</p>}
        {policyOpen && (
          <div className="space-y-2">
            <input value={policyName} onChange={e => setPolicyName(e.target.value)} placeholder="Policy name and version" className="field" aria-label="Policy name" />
            <textarea value={policyText} onChange={e => setPolicyText(e.target.value)} placeholder="Paste the medical-necessity criteria excerpt…" className="field h-48 resize-y leading-6" aria-label="Policy text" />
          </div>
        )}
      </Section>

      <div className="sticky bottom-0 -mx-4 space-y-3 border-t border-line bg-canvas/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        {err && <p className="text-sm text-bad" role="alert">{err}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <button className="btn-primary px-6 py-2.5 text-base" disabled={busy} onClick={submit}>{busy ? 'Starting…' : 'Review this packet'}</button>
          <button className="link text-sm" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>Advanced {advanced ? '▴' : '▾'}</button>
        </div>
      </div>
      {advanced && (
        <div className="space-y-3">
          <input value={caseId} onChange={e => setCaseId(e.target.value)} placeholder="Case ID (optional)" className="field max-w-xs" aria-label="Case ID" />
          <div>
            <div className="mb-1 text-sm font-medium">The same request as an API call</div>
            <pre className="max-h-72 overflow-auto rounded-lg bg-code p-3 text-xs text-code-ink">{curl}</pre>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ n, title, right, children }: { n: number; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft font-mono text-sm font-semibold text-accent">{n}</span>
        <h2 className="flex-1 text-lg font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}
