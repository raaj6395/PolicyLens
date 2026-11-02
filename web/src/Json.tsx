import { useEffect, useState } from 'react'

type Props = { value: any; active?: string; onPick?: (path: string) => void; name: string }

export function saveJson(name: string, value: any) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  a.download = `${name}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function JsonPanel({ value, active, onPick, name }: Props) {
  const text = JSON.stringify(value, null, 2)
  useEffect(() => {
    if (active) document.getElementById(`json-${name}-${active}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [active, name])
  const download = () => saveJson(name, value)
  return (
    <div>
      <div className="mb-2 flex gap-2">
        <button className="btn" onClick={() => navigator.clipboard.writeText(text)}>Copy</button>
        <button className="btn" onClick={download}>Download</button>
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg bg-code p-3 font-mono text-xs leading-5 text-code-ink">
        <Node k={null} v={value} path="" depth={0} active={active} onPick={onPick} name={name} />
      </div>
    </div>
  )
}

function Node({ k, v, path, depth, active, onPick, name }: { k: string | null; v: any; path: string; depth: number; active?: string; onPick?: (p: string) => void; name: string }) {
  const [open, setOpen] = useState(depth < 2 || (!!active && active.startsWith(path) && path !== ''))
  useEffect(() => { if (active && path && active.startsWith(path)) setOpen(true) }, [active, path])
  const label = k === null ? null : <span className="text-sky-300">{k}: </span>
  const isActive = active === path && path !== ''
  const pick = (e: React.MouseEvent) => { e.stopPropagation(); onPick?.(path) }
  const isObj = v !== null && typeof v === 'object'
  if (!isObj) {
    const cls = typeof v === 'string' ? 'text-emerald-300' : typeof v === 'number' ? 'text-amber-300' : 'text-fuchsia-300'
    return <div id={`json-${name}-${path}`} onClick={pick} className={`cursor-pointer pl-4 hover:bg-slate-800 ${isActive ? 'bg-sky-900' : ''}`}>{label}<span className={`${cls} break-words`}>{JSON.stringify(v)}</span></div>
  }
  const entries: [string, any][] = Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v)
  const [o, c] = Array.isArray(v) ? ['[', ']'] : ['{', '}']
  const child = (key: string) => Array.isArray(v) ? `${path}[${key}]` : path ? `${path}.${key}` : key
  return (
    <div id={`json-${name}-${path}`} className={`pl-4 ${isActive ? 'rounded bg-sky-900/70 ring-1 ring-sky-400' : ''}`}>
      <span className="cursor-pointer select-none text-slate-400" onClick={() => setOpen(!open)}>{open ? '▾ ' : '▸ '}</span>
      <span className="cursor-pointer" onClick={pick}>{label}{o}</span>
      {open ? (
        <>
          {entries.map(([key, x]) => <Node key={key} k={Array.isArray(v) ? null : key} v={x} path={child(key)} depth={depth + 1} active={active} onPick={onPick} name={name} />)}
          <div>{c}</div>
        </>
      ) : <span className="text-slate-500"> {entries.length} {Array.isArray(v) ? 'items' : 'keys'} {c}</span>}
    </div>
  )
}
