import { useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import './App.css'
import type { AppState, Firefighter, VitalsEntry } from './types'
import { clearState, loadState, saveState } from './storage'
import { downloadText, exportCsv, exportPdf, downloadBlob, shareFilesIfPossible } from './exporters'

function clampNum(v: string): number | undefined {
  const t = v.trim()
  if (!t) return undefined
  const n = Number(t)
  if (!Number.isFinite(n)) return undefined
  return n
}

function minutesAgo(ts: number) {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins <= 0) return 'just now'
  if (mins === 1) return '1 min ago'
  return `${mins} min ago`
}

type AlertKey = 'hr' | 'rr' | 'spo2' | 'bp' | 'temp'

type TrendMetric = 'hr' | 'rr' | 'spo2' | 'temp' | 'bp'

function pointsForMetric(entries: VitalsEntry[], metric: TrendMetric) {
  const asc = entries.slice().sort((a, b) => a.timestamp - b.timestamp)

  if (metric === 'bp') {
    const sys = asc.filter((v) => typeof v.bpSys === 'number').map((v) => ({ x: v.timestamp, y: v.bpSys as number }))
    const dia = asc.filter((v) => typeof v.bpDia === 'number').map((v) => ({ x: v.timestamp, y: v.bpDia as number }))
    return { sys, dia }
  }

  const key: Record<Exclude<TrendMetric, 'bp'>, keyof VitalsEntry> = {
    hr: 'hr',
    rr: 'rr',
    spo2: 'spo2',
    temp: 'tempF',
  }

  const k = key[metric as Exclude<TrendMetric, 'bp'>]
  const pts = asc
    .filter((v) => typeof (v as any)[k] === 'number')
    .map((v) => ({ x: v.timestamp, y: (v as any)[k] as number }))

  return { pts }
}

function SparkLine({ data, width = 640, height = 220 }: { data: { x: number; y: number }[]; width?: number; height?: number }) {
  if (!data.length) return <div className="empty">No data for this vital yet.</div>

  const minX = Math.min(...data.map((p) => p.x))
  const maxX = Math.max(...data.map((p) => p.x))
  const minY = Math.min(...data.map((p) => p.y))
  const maxY = Math.max(...data.map((p) => p.y))

  const pad = 18
  const w = width
  const h = height

  const sx = (x: number) => {
    if (maxX === minX) return pad
    return pad + ((x - minX) / (maxX - minX)) * (w - pad * 2)
  }
  const sy = (y: number) => {
    if (maxY === minY) return h / 2
    return h - pad - ((y - minY) / (maxY - minY)) * (h - pad * 2)
  }

  const d = data.map((p, i) => `${i === 0 ? 'M' : 'L'} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={height} className="chart">
      <rect x={0} y={0} width={w} height={h} fill="#ffffff" />
      <path d={d} fill="none" stroke="#1d4ed8" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
      {/* y-axis labels */}
      <text x={pad} y={pad} fontSize={12} fill="#334155">{maxY.toFixed(0)}</text>
      <text x={pad} y={h - 6} fontSize={12} fill="#334155">{minY.toFixed(0)}</text>
    </svg>
  )
}

function getAlerts(v: VitalsEntry): Set<AlertKey> {
  const a = new Set<AlertKey>()

  // Simple v1 thresholds (tweakable). Use only if value present.
  if (typeof v.hr === 'number' && (v.hr >= 160 || v.hr <= 45)) a.add('hr')
  if (typeof v.rr === 'number' && (v.rr >= 30 || v.rr <= 8)) a.add('rr')
  if (typeof v.spo2 === 'number' && v.spo2 < 92) a.add('spo2')
  if (typeof v.tempF === 'number' && v.tempF >= 101.0) a.add('temp')
  if (
    (typeof v.bpSys === 'number' && (v.bpSys >= 180 || v.bpSys <= 90)) ||
    (typeof v.bpDia === 'number' && (v.bpDia >= 110 || v.bpDia <= 60))
  ) {
    a.add('bp')
  }

  return a
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState())

  useEffect(() => {
    saveState(state)
  }, [state])

  const sortedFirefighters = useMemo(() => {
    return state.firefighters
      .slice()
      .sort((a, b) => (`${a.lastName} ${a.firstName}`.trim()).localeCompare(`${b.lastName} ${b.firstName}`.trim()))
  }, [state.firefighters])

  const selected = useMemo(() => {
    return state.firefighters.find((f) => f.id === state.selectedFirefighterId) ?? null
  }, [state.firefighters, state.selectedFirefighterId])

  const selectedVitals = useMemo(() => {
    if (!selected) return []
    return state.vitals
      .filter((v) => v.firefighterId === selected.id)
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [state.vitals, selected])

  const [form, setForm] = useState({ hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
  const [showNewVitals, setShowNewVitals] = useState(false)
  const [trend, setTrend] = useState<null | { metric: 'hr' | 'rr' | 'spo2' | 'temp' | 'bp' }>(null)

  useEffect(() => {
    // reset form when switching firefighters
    setForm({ hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
    setShowNewVitals(false)
  }, [state.selectedFirefighterId])

  const [ffModal, setFfModal] = useState<null | { mode: 'add' | 'edit'; id?: string }>(null)
  const [ffForm, setFfForm] = useState({ firstName: '', lastName: '', unit: '' })

  const openAddFirefighter = () => {
    setFfForm({ firstName: '', lastName: '', unit: '' })
    setFfModal({ mode: 'add' })
  }

  const openEditFirefighter = (ff: Firefighter) => {
    setFfForm({ firstName: ff.firstName ?? '', lastName: ff.lastName ?? '', unit: ff.unit ?? '' })
    setFfModal({ mode: 'edit', id: ff.id })
  }

  const saveFirefighter = () => {
    const firstName = ffForm.firstName.trim()
    const lastName = ffForm.lastName.trim()
    const unit = ffForm.unit.trim()

    if (!firstName && !lastName) {
      alert('Enter at least a first name or last name.')
      return
    }

    if (!ffModal) return

    if (ffModal.mode === 'add') {
      const ff: Firefighter = { id: nanoid(), firstName, lastName, unit: unit || undefined }
      setState((s) => ({
        ...s,
        firefighters: [...s.firefighters, ff],
        selectedFirefighterId: ff.id,
      }))
      setFfModal(null)
      return
    }

    const id = ffModal.id
    if (!id) return
    setState((s) => ({
      ...s,
      firefighters: s.firefighters.map((f) => (f.id === id ? { ...f, firstName, lastName, unit: unit || undefined } : f)),
    }))
    setFfModal(null)
  }

  const removeFirefighter = (id: string) => {
    const ff = state.firefighters.find((f) => f.id === id)
    if (!ff) return
    const label = `${ff.lastName}, ${ff.firstName}`.replace(/^,\s*/, '').trim()
    if (!confirm(`Remove ${label} and all their vitals?`)) return
    setState((s) => {
      const remaining = s.firefighters.filter((f) => f.id !== id)
      const vitals = s.vitals.filter((v) => v.firefighterId !== id)
      const selectedFirefighterId = s.selectedFirefighterId === id ? (remaining[0]?.id ?? null) : s.selectedFirefighterId
      return { ...s, firefighters: remaining, vitals, selectedFirefighterId }
    })
  }

  const submitVitals = () => {
    if (!selected) {
      alert('Add/select a firefighter first.')
      return
    }

    const entry: VitalsEntry = {
      id: nanoid(),
      firefighterId: selected.id,
      timestamp: Date.now(),
      hr: clampNum(form.hr),
      rr: clampNum(form.rr),
      spo2: clampNum(form.spo2),
      bpSys: clampNum(form.bpSys),
      bpDia: clampNum(form.bpDia),
      tempF: clampNum(form.tempF),
      notes: form.notes.trim() || undefined,
    }

    setState((s) => ({ ...s, vitals: [...s.vitals, entry] }))
    setForm({ hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
    setShowNewVitals(false)
  }

  const exportAll = async () => {
    const baseName = `firefighter-vitals-${new Date().toISOString().slice(0, 10)}`

    const csv = exportCsv(state.firefighters, state.vitals)
    const csvBlob = new Blob([csv], { type: 'text/csv' })
    const pdfBlob = exportPdf(state.firefighters, state.vitals)

    const files = [
      new File([csvBlob], `${baseName}.csv`, { type: 'text/csv' }),
      new File([pdfBlob], `${baseName}.pdf`, { type: 'application/pdf' }),
    ]

    // Try native share (best on mobile)
    try {
      const ok = await shareFilesIfPossible(files, 'Firefighter Vitals Export')
      if (ok) return
    } catch {
      // ignore; fallback to downloads
    }

    // Fallback: download both
    downloadText(csv, `${baseName}.csv`, 'text/csv')
    downloadBlob(pdfBlob, `${baseName}.pdf`)
  }

  const mailtoExport = () => {
    // mailto can't attach files reliably; we open a draft with instructions.
    const subject = encodeURIComponent('Firefighter Vitals Export')
    const body = encodeURIComponent(
      `Attached are the vitals exports (CSV + PDF).\n\nTip: if your browser downloaded the files, attach them from Downloads.\n\nExport time: ${new Date().toLocaleString()}`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  const reset = () => {
    if (!confirm('Clear current scene roster + vitals on this device?')) return
    clearState()
    setState({ firefighters: [], selectedFirefighterId: null, vitals: [] })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="title">Firefighter Vitals (Current Scene)</div>
          <div className="subtitle">Offline on this device • Export CSV/PDF</div>
        </div>
        <div className="topActions">
          <button className="btn" onClick={exportAll}>Share / Export</button>
          <button className="btn secondary" onClick={mailtoExport}>Mailto</button>
          <button className="btn danger" onClick={reset}>Clear</button>
        </div>
      </header>

      <div className="grid">
        <aside className="panel">
          <div className="panelHeader">
            <div className="panelTitle">On Scene</div>
            <button className="btn small" onClick={openAddFirefighter}>+ Add</button>
          </div>

          {sortedFirefighters.length === 0 ? (
            <div className="empty">No firefighters yet. Tap “Add”.</div>
          ) : (
            <div className="list">
              {sortedFirefighters.map((f) => {
                const last = state.vitals
                  .filter((v) => v.firefighterId === f.id)
                  .slice()
                  .sort((a, b) => b.timestamp - a.timestamp)[0]

                const isSel = f.id === state.selectedFirefighterId
                return (
                  <div
                    key={f.id}
                    className={isSel ? 'row selected' : 'row'}
                    onClick={() => setState((s) => ({ ...s, selectedFirefighterId: f.id }))}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="rowMain">
                      <div className="rowName">{`${f.lastName}, ${f.firstName}`.replace(/^,\s*/, '').trim()}</div>
                      <div className="rowMeta">{f.unit ?? ''}</div>
                      <div className="rowMeta">{last ? `Last: ${minutesAgo(last.timestamp)}` : 'No vitals yet'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button className="iconBtn" onClick={(e) => { e.stopPropagation(); openEditFirefighter(f) }} title="Edit">✎</button>
                      <button className="iconBtn" onClick={(e) => { e.stopPropagation(); removeFirefighter(f.id) }} title="Remove">×</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </aside>

        <main className="panel">
          <div className="panelHeader">
            <div className="panelTitle">Vitals</div>
            <div className="panelSub">{selected ? `${`${selected.lastName}, ${selected.firstName}`.replace(/^,\s*/, '').trim()}${selected.unit ? ` (${selected.unit})` : ''}` : 'Select a firefighter'}</div>
          </div>

          {!selected ? (
            <div className="empty">Select a firefighter to view vitals.</div>
          ) : (
            <div style={{ padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <div className="panelSub">
                  {selectedVitals[0] ? `Last recorded: ${new Date(selectedVitals[0].timestamp).toLocaleString()}` : 'No vitals recorded yet.'}
                </div>
                <button className="btn" onClick={() => setShowNewVitals(true)}>+ New vitals</button>
              </div>

              {selectedVitals[0] ? (() => {
                const v = selectedVitals[0]
                const alerts = getAlerts(v)
                const flag = (k: AlertKey) => (alerts.has(k) ? <span className="alert">❗️</span> : null)
                return (
                  <div className="card" style={{ margin: 0 }}>
                    <div className="cardGrid">
                      <button className="vitalBtn" onClick={() => setTrend({ metric: 'hr' })}>
                        HR: <b>{v.hr ?? '—'}</b> {flag('hr')}
                      </button>
                      <button className="vitalBtn" onClick={() => setTrend({ metric: 'rr' })}>
                        RR: <b>{v.rr ?? '—'}</b> {flag('rr')}
                      </button>
                      <button className="vitalBtn" onClick={() => setTrend({ metric: 'spo2' })}>
                        SpO₂: <b>{v.spo2 ?? '—'}</b> {flag('spo2')}
                      </button>
                      <button className="vitalBtn" onClick={() => setTrend({ metric: 'bp' })}>
                        BP: <b>{v.bpSys ?? '—'}</b> / <b>{v.bpDia ?? '—'}</b> {flag('bp')}
                      </button>
                      <button className="vitalBtn" onClick={() => setTrend({ metric: 'temp' })}>
                        TempF: <b>{v.tempF ?? '—'}</b> {flag('temp')}
                      </button>
                    </div>
                    {v.notes ? <div className="notes">{v.notes}</div> : null}
                    <div className="fine" style={{ marginTop: 6 }}>Tap a vital to see trend</div>
                  </div>
                )
              })() : null}
            </div>
          )}

          {showNewVitals && selected ? (
            <div className="modalOverlay" onClick={() => setShowNewVitals(false)} role="presentation">
              <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
                <div className="modalHeader">
                  <div>
                    <div className="panelTitle">New vitals</div>
                    <div className="panelSub">{`${`${selected.lastName}, ${selected.firstName}`.replace(/^,\s*/, '').trim()}`}{selected.unit ? ` (${selected.unit})` : ''}</div>
                  </div>
                  <button className="btn secondary" onClick={() => setShowNewVitals(false)}>Close</button>
                </div>

                <div className="form" style={{ paddingTop: 0 }}>
                  <div className="formGrid">
                    <label>
                      HR
                      <input inputMode="numeric" value={form.hr} onChange={(e) => setForm((f) => ({ ...f, hr: e.target.value }))} placeholder="" />
                    </label>
                    <label>
                      RR
                      <input inputMode="numeric" value={form.rr} onChange={(e) => setForm((f) => ({ ...f, rr: e.target.value }))} placeholder="" />
                    </label>
                    <label>
                      SpO₂
                      <input inputMode="numeric" value={form.spo2} onChange={(e) => setForm((f) => ({ ...f, spo2: e.target.value }))} placeholder="" />
                    </label>
                    <label>
                      BP
                      <div className="bpRow">
                        <input
                          className="bpInput"
                          inputMode="numeric"
                          value={form.bpSys}
                          onChange={(e) => setForm((f) => ({ ...f, bpSys: e.target.value }))}
                          placeholder="Sys"
                          aria-label="Blood pressure systolic"
                        />
                        <div className="bpSlash">/</div>
                        <input
                          className="bpInput"
                          inputMode="numeric"
                          value={form.bpDia}
                          onChange={(e) => setForm((f) => ({ ...f, bpDia: e.target.value }))}
                          placeholder="Dia"
                          aria-label="Blood pressure diastolic"
                        />
                      </div>
                    </label>
                    <label>
                      Temp (F)
                      <input inputMode="decimal" value={form.tempF} onChange={(e) => setForm((f) => ({ ...f, tempF: e.target.value }))} placeholder="" />
                    </label>
                  </div>

                  <label>
                    Notes
                    <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional" rows={3} />
                  </label>

                  <div className="formActions">
                    <button className="btn" onClick={submitVitals}>Save vitals</button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className="divider" />

          <div className="panelHeader" style={{ paddingTop: 0 }}>
            <div className="panelTitle">History</div>
            <div className="panelSub">{selected ? `${selectedVitals.length} entries` : ''}</div>
          </div>

          {!selected ? (
            <div className="empty">Select a firefighter to see history.</div>
          ) : selectedVitals.length === 0 ? (
            <div className="empty">No vitals recorded yet.</div>
          ) : (
            <div className="history">
              {selectedVitals.map((v) => {
                const alerts = getAlerts(v)
                const flag = (k: AlertKey) => (alerts.has(k) ? <span className="alert">❗️</span> : null)

                return (
                  <div key={v.id} className="card">
                    <div className="cardTitle">{new Date(v.timestamp).toLocaleString()}</div>
                    <div className="cardGrid">
                      <div>HR: <b>{v.hr ?? '—'}</b> {flag('hr')}</div>
                      <div>RR: <b>{v.rr ?? '—'}</b> {flag('rr')}</div>
                      <div>SpO₂: <b>{v.spo2 ?? '—'}</b> {flag('spo2')}</div>
                      <div>BP: <b>{v.bpSys ?? '—'}</b> / <b>{v.bpDia ?? '—'}</b> {flag('bp')}</div>
                      <div>TempF: <b>{v.tempF ?? '—'}</b> {flag('temp')}</div>
                    </div>
                    {alerts.size ? (
                      <div className="fine" style={{ color: '#b91c1c', opacity: 0.9 }}>
                        Threshold alert(s) on this entry.
                      </div>
                    ) : null}
                    {v.notes ? <div className="notes">{v.notes}</div> : null}
                  </div>
                )
              })}
            </div>
          )}
        </main>
      </div>

      <footer className="footer">
        <div className="fine">Note: “Mailto” can’t auto-attach files on most devices; use it to open a draft, then attach the downloaded CSV/PDF.</div>
      </footer>

      {ffModal ? (
        <div className="modalOverlay" onClick={() => setFfModal(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <div className="panelTitle">{ffModal.mode === 'add' ? 'Add firefighter' : 'Edit firefighter'}</div>
                <div className="panelSub">Name + unit/company</div>
              </div>
              <button className="btn secondary" onClick={() => setFfModal(null)}>Close</button>
            </div>

            <div className="form" style={{ paddingTop: 0 }}>
              <div className="formGrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <label>
                  First name
                  <input value={ffForm.firstName} onChange={(e) => setFfForm((f) => ({ ...f, firstName: e.target.value }))} placeholder="" />
                </label>
                <label>
                  Last name
                  <input value={ffForm.lastName} onChange={(e) => setFfForm((f) => ({ ...f, lastName: e.target.value }))} placeholder="" />
                </label>
              </div>

              <label>
                Unit / Company
                <input value={ffForm.unit} onChange={(e) => setFfForm((f) => ({ ...f, unit: e.target.value }))} placeholder="" />
              </label>

              <div className="formActions">
                <button className="btn" onClick={saveFirefighter}>Save</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {trend && selected ? (
        <div className="modalOverlay" onClick={() => setTrend(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <div className="panelTitle">Trend: {trend.metric.toUpperCase()}</div>
                <div className="panelSub">{`${selected.lastName}, ${selected.firstName}`.replace(/^,\s*/, '').trim()}{selected.unit ? ` (${selected.unit})` : ''}</div>
              </div>
              <button className="btn secondary" onClick={() => setTrend(null)}>Close</button>
            </div>

            <div style={{ padding: 14, display: 'grid', gap: 10 }}>
              {trend.metric === 'bp' ? (() => {
                const { sys, dia } = pointsForMetric(selectedVitals, 'bp') as any
                const maxLen = Math.max(sys.length, dia.length)
                if (maxLen === 0) return <div className="empty">No data for BP yet.</div>
                return (
                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <div className="fine" style={{ marginBottom: 6 }}><b>Sys</b></div>
                      <SparkLine data={sys} />
                    </div>
                    <div>
                      <div className="fine" style={{ marginBottom: 6 }}><b>Dia</b></div>
                      <SparkLine data={dia} />
                    </div>
                  </div>
                )
              })() : (() => {
                const metric = trend.metric as Exclude<TrendMetric, 'bp'>
                const pts = (pointsForMetric(selectedVitals, metric) as any).pts as { x: number; y: number }[]
                return <SparkLine data={pts} />
              })()}

              <div className="fine">Shows recorded values over time (missing values are skipped).</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
