import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

type GlyphKind = 'check' | 'half' | 'x' | 'q' | 'swap'
type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'conflict'

export const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  muted: 'bg-sunken text-muted',
  conflict: 'bg-conflict-soft text-conflict',
}
export const TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad', muted: 'text-muted', conflict: 'text-conflict' }
const RING: Record<Tone, string> = { ok: 'ring-ok/50', warn: 'ring-warn/50', bad: 'ring-bad/50', muted: 'ring-line', conflict: 'ring-conflict/50' }

export const STATUS: Record<string, { label: string; glyph: GlyphKind; tone: Tone }> = {
  MET: { label: 'Satisfied', glyph: 'check', tone: 'ok' },
  PARTIALLY_MET: { label: 'Partly shown', glyph: 'half', tone: 'warn' },
  UNMET: { label: 'Not satisfied', glyph: 'x', tone: 'bad' },
  NOT_ASSESSABLE: { label: 'No information', glyph: 'q', tone: 'muted' },
  FOUND: { label: 'Found', glyph: 'check', tone: 'ok' },
  MISSING: { label: 'Not in packet', glyph: 'q', tone: 'muted' },
  CONFLICT: { label: 'Sources disagree', glyph: 'swap', tone: 'conflict' },
}

export const VERDICT: Record<string, { label: string; short: string; glyph: GlyphKind; tone: Tone }> = {
  LIKELY_APPROVE: { label: 'Likely approve', short: 'Approve', glyph: 'check', tone: 'ok' },
  NEED_MORE_INFO: { label: 'Needs more information', short: 'Needs info', glyph: 'half', tone: 'warn' },
  LIKELY_DENY: { label: 'Likely deny', short: 'Deny', glyph: 'x', tone: 'bad' },
}
export const VERDICT_ORDER = ['LIKELY_APPROVE', 'NEED_MORE_INFO', 'LIKELY_DENY']

export const CATEGORY: Record<string, string> = {
  SUPPORTED_DOCUMENTED: 'Clinically supported and well documented.',
  PLAUSIBLE_INCOMPLETE: 'Clinically plausible, but the documentation is incomplete. This is a paperwork gap, not a clinical denial.',
  NOT_NECESSARY_UNDER_POLICY: 'Not medically necessary under the supplied policy.',
}

export const LEVEL: Record<string, string> = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' }

export const CATEGORY_SHORT: Record<string, string> = {
  SUPPORTED_DOCUMENTED: 'Supported and documented',
  PLAUSIBLE_INCOMPLETE: 'Plausible, documentation incomplete',
  NOT_NECESSARY_UNDER_POLICY: 'Not necessary under the policy',
}

export const WORKFLOW: Record<string, string> = { PEND_FOR_CLINICALS: 'Waiting on documents', READY_FOR_DECISION: 'Ready for a decision' }

export const RULES = [
  { id: 'no_criteria', when: 'Nothing could be checked against the policy', then: 'NEED_MORE_INFO' },
  { id: 'core_unmet', when: 'A required criterion is clearly not satisfied', then: 'LIKELY_DENY' },
  { id: 'partial_or_not_assessable', when: 'A required criterion is only partly shown or has no information', then: 'NEED_MORE_INFO' },
  { id: 'core_met_admin_gap', when: 'Every required criterion is satisfied; only a paperwork item is incomplete', then: 'LIKELY_APPROVE' },
  { id: 'all_met', when: 'Every criterion is satisfied with verified evidence', then: 'LIKELY_APPROVE' },
]

const PATHS: Record<GlyphKind, ReactNode> = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M7 7l10 10M17 7L7 17" />,
  half: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 010 16z" fill="currentColor" /></>,
  q: <><path d="M9.5 9.2a2.6 2.6 0 115 .9c-.6 1.2-2.5 1.6-2.5 3.4" /><path d="M12 17.5h.01" /></>,
  swap: <path d="M6 9h12l-3.5-3.5M18 15H6l3.5 3.5" />,
}

export function Glyph({ kind, className = 'h-3.5 w-3.5' }: { kind: GlyphKind; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[kind]}
    </svg>
  )
}

const statusOf = (s: string) => STATUS[s] ?? { label: s, glyph: 'q' as GlyphKind, tone: 'muted' as Tone }
const verdictOf = (r: string) => VERDICT[r] ?? { label: r, short: r, glyph: 'q' as GlyphKind, tone: 'muted' as Tone }

export function Badge({ status }: { status: string }) {
  const s = statusOf(status)
  return (
    <span title={status} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-semibold ${TONE[s.tone]}`}>
      <Glyph kind={s.glyph} className="h-3 w-3" />{s.label}
    </span>
  )
}

export function StatusDot({ status }: { status: string }) {
  const s = statusOf(status)
  return <span title={status} className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${TONE[s.tone]}`}><Glyph kind={s.glyph} /><span className="sr-only">{s.label}</span></span>
}

export function Verdict({ rec, short }: { rec: string; short?: boolean }) {
  const v = verdictOf(rec)
  return (
    <span title={rec} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[v.tone]}`}>
      <Glyph kind={v.glyph} className="h-3 w-3" />{short ? v.short : v.label}
    </span>
  )
}

export function Rail({ rec }: { rec: string }) {
  return (
    <div role="img" aria-label={`Verdict: ${verdictOf(rec).label}`} className="grid grid-cols-3 gap-1 rounded-xl bg-sunken p-1">
      {VERDICT_ORDER.map(k => {
        const v = VERDICT[k]
        const on = k === rec
        return (
          <div key={k} className={`flex items-center justify-center gap-2 rounded-lg px-2 py-3 text-center text-sm font-semibold sm:text-base ${on ? `${TONE[v.tone]} shadow-sm ring-2 ${RING[v.tone]}` : 'text-muted'}`}>
            {on && <Glyph kind={v.glyph} className="hidden h-4 w-4 sm:block" />}
            {on ? v.label : v.short}
          </div>
        )
      })}
    </div>
  )
}

export function Tabs<T extends string>({ items, value, onChange, right }: { items: [T, ReactNode][]; value: T; onChange: (t: T) => void; right?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const i = items.findIndex(x => x[0] === value)
    const next = items[(i + d + items.length) % items.length][0]
    onChange(next)
    ref.current?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus()
  }
  return (
    <div className="flex items-end gap-3 border-b border-line">
      <div ref={ref} role="tablist" onKeyDown={onKey} className="tabs -mb-px min-w-0 flex-1 border-b-0">
        {items.map(([k, label]) => (
          <button key={k} role="tab" data-tab={k} aria-selected={k === value} tabIndex={k === value ? 0 : -1} onClick={() => onChange(k)}>{label}</button>
        ))}
      </div>
      {right && <div className="shrink-0 pb-1.5">{right}</div>}
    </div>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="card flex items-center gap-3 p-6 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />{label}
    </div>
  )
}

const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)

export function useRoute() {
  const [route, setRoute] = useState(parse)
  useEffect(() => {
    const f = () => { setRoute(parse()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return route
}

export const go = (path: string) => { location.hash = `/${path}` }

export const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
export const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { return } }

export const caseTitle = (title: string) => (title.includes(' · ') ? title.split(' · ').slice(1).join(' · ') : title).replace(' (authored)', '')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDate = (d?: string) => {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : d ?? ''
}
export const daysBefore = (d?: string, ref?: string) => {
  if (!d || !ref || d === ref) return ''
  const n = Math.round((Date.parse(ref) - Date.parse(d)) / 864e5)
  if (!Number.isFinite(n) || n === 0) return ''
  return n > 0 ? `${n} day${n === 1 ? '' : 's'} before the request` : `${-n} day${n === -1 ? '' : 's'} after the request`
}
export const prettyType = (t?: string) => (t ? t.replace(/_/g, ' ').replace(/\bh and p\b/, 'H&P') : '')

export const shortLabel = (c: { label?: string; criterion_text: string }) => {
  if (c.label) return c.label
  const head = c.criterion_text.replace(/^\[No policy supplied\]\s*/, '').split(/[,;:(]| \bwith\b| \bwithin\b/)[0].trim().replace(/\.$/, '')
  const words = head.split(/\s+/)
  return words.length > 7 ? words.slice(0, 6).join(' ') + '…' : head
}

export type Lex = { doc: Record<string, { name: string; date?: string; type?: string }>; fact: Record<string, string>; crit: Record<string, string>; requestDate?: string }

export function makeLex(docs: { doc_id?: string; name: string; date?: string; type?: string }[], facts: { fact_id: string; aspect: string }[], criteria: { criterion_id: string; label?: string; criterion_text: string }[]): Lex {
  return {
    doc: Object.fromEntries(docs.map(d => [d.doc_id ?? '', d])),
    fact: Object.fromEntries(facts.map(f => [f.fact_id, f.aspect])),
    crit: Object.fromEntries(criteria.map(c => [c.criterion_id, shortLabel(c)])),
    requestDate: docs.find(d => d.type === 'request_form')?.date ?? docs.map(d => d.date ?? '').sort().at(-1),
  }
}

type Part = string | { id: string; name: string; kind: 'doc' | 'fact' | 'crit' }

const ANATOMY = /^\s*(distribution|dermatome|myotome|nerve|root|radicul|vertebra|level|disc|spinous|pedicle|lamina|cord|segment|fracture)/i
const anatomical = (text: string, i: number, id: string) => {
  const before = text.slice(Math.max(0, i - 12), i)
  const after = text.slice(i + id.length, i + id.length + 16)
  return /[-–‑‐/]\s*$/.test(before) || /^\s*[-–‑‐/]/.test(after) || ANATOMY.test(after) || /\b(at|level|levels)\s*$/i.test(before)
}

function parts(text: string, lex: Lex, crit: boolean): Part[] {
  const out: Part[] = []
  let at = 0
  for (const m of text.matchAll(/\b([DF]\d+|C\d+[a-z]?)\b/g)) {
    const id = m[1]
    const i = m.index!
    if (/vitamin\s*$/i.test(text.slice(Math.max(0, i - 9), i))) continue
    if (id[0] === 'C' && !crit && anatomical(text, i, id)) continue
    const kind = id[0] === 'D' ? 'doc' : id[0] === 'F' ? 'fact' : 'crit'
    const name = kind === 'doc' ? lex.doc[id]?.name : kind === 'fact' ? lex.fact[id] : lex.crit[id]
    if (!name) continue
    out.push(text.slice(at, i), { id, name, kind })
    at = i + id.length
  }
  out.push(text.slice(at))
  return out.filter(p => p !== '')
}

export const plain = (text: string | undefined, lex: Lex, crit = false) =>
  parts(text ?? '', lex, crit).map(p => (typeof p === 'string' ? p : `“${p.name}”`)).join('')

export function Humane({ text, lex, crit = false, onDoc, onFact }: { text?: string; lex: Lex; crit?: boolean; onDoc?: (id: string) => void; onFact?: (id: string) => void }) {
  return (
    <>
      {parts(text ?? '', lex, crit).map((p, i) => {
        if (typeof p === 'string') return p
        const click = p.kind === 'doc' ? onDoc : p.kind === 'fact' ? onFact : undefined
        const cls = 'rounded bg-sunken px-1 font-medium text-ink'
        return click
          ? <button key={i} title={p.id} onClick={e => { e.stopPropagation(); click(p.id) }} className={`${cls} hover:ring-1 hover:ring-accent`}>{p.name}</button>
          : <span key={i} title={p.id} className={cls}>{p.name}</span>
      })}
    </>
  )
}

export function friendlyError(raw: string): { title: string; hint: string } {
  if (/no credits|insufficient_quota|billing/i.test(raw)) return { title: 'The AI provider account is out of credits.', hint: 'Add credits with the provider, or switch LLM_PROVIDER in .env and restart, then try again.' }
  if (/\b429\b|rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(raw)) return { title: 'The AI provider is limiting requests right now.', hint: 'Wait a minute and try again.' }
  if (/\b40[13]\b|api key|PERMISSION_DENIED|unauthori[sz]ed/i.test(raw)) return { title: 'The AI provider rejected the API key.', hint: 'Check the key for the selected provider in .env and restart the server.' }
  if (/timeout|deadline exceeded|context canceled/i.test(raw)) return { title: 'The AI provider took too long to answer.', hint: 'Try again; long packets can take over a minute.' }
  if (/failed validation|jsonschema|schema/i.test(raw)) return { title: 'The AI returned output that failed validation twice.', hint: 'Try again; this is usually a one-off.' }
  if (/invalid_request|documents is required|is empty|exceeds/i.test(raw)) return { title: 'The packet could not be accepted.', hint: 'Check that every document has text, then submit again.' }
  return { title: 'The review could not finish.', hint: 'Try again. If it keeps failing, download the report and share it.' }
}
