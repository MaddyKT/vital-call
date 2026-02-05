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
    return state.firefighters.slice().sort((a, b) => a.name.localeCompare(b.name))
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

  useEffect(() => {
    // reset form when switching firefighters
    setForm({ hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
    setShowNewVitals(false)
  }, [state.selectedFirefighterId])

  const addFirefighter = () => {
    const name = prompt('Firefighter name?')?.trim()
    if (!name) return
    const unit = prompt('Unit/company? (optional)')?.trim() ?? ''
    const ff: Firefighter = { id: nanoid(), name, unit: unit || undefined }
    setState((s) => ({
      ...s,
      firefighters: [...s.firefighters, ff].sort((a, b) => a.name.localeCompare(b.name)),
      selectedFirefighterId: ff.id,
    }))
  }

  const removeFirefighter = (id: string) => {
    const ff = state.firefighters.find((f) => f.id === id)
    if (!ff) return
    if (!confirm(`Remove ${ff.name} and all their vitals?`)) return
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
            <button className="btn small" onClick={addFirefighter}>+ Add</button>
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
                      <div className="rowName">{f.name}</div>
                      <div className="rowMeta">{f.unit ?? ''}</div>
                      <div className="rowMeta">{last ? `Last: ${minutesAgo(last.timestamp)}` : 'No vitals yet'}</div>
                    </div>
                    <button className="iconBtn" onClick={(e) => { e.stopPropagation(); removeFirefighter(f.id) }} title="Remove">×</button>
                  </div>
                )
              })}
            </div>
          )}
        </aside>

        <main className="panel">
          <div className="panelHeader">
            <div className="panelTitle">Vitals</div>
            <div className="panelSub">{selected ? `${selected.name}${selected.unit ? ` (${selected.unit})` : ''}` : 'Select a firefighter'}</div>
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
                      <div>HR: <b>{v.hr ?? '—'}</b> {flag('hr')}</div>
                      <div>RR: <b>{v.rr ?? '—'}</b> {flag('rr')}</div>
                      <div>SpO₂: <b>{v.spo2 ?? '—'}</b> {flag('spo2')}</div>
                      <div>BP: <b>{v.bpSys ?? '—'}</b> / <b>{v.bpDia ?? '—'}</b> {flag('bp')}</div>
                      <div>TempF: <b>{v.tempF ?? '—'}</b> {flag('temp')}</div>
                    </div>
                    {v.notes ? <div className="notes">{v.notes}</div> : null}
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
                    <div className="panelSub">{selected.name}{selected.unit ? ` (${selected.unit})` : ''}</div>
                  </div>
                  <button className="btn secondary" onClick={() => setShowNewVitals(false)}>Close</button>
                </div>

                <div className="form" style={{ paddingTop: 0 }}>
                  <div className="formGrid">
                    <label>
                      HR
                      <input inputMode="numeric" value={form.hr} onChange={(e) => setForm((f) => ({ ...f, hr: e.target.value }))} placeholder="(blank ok)" />
                    </label>
                    <label>
                      RR
                      <input inputMode="numeric" value={form.rr} onChange={(e) => setForm((f) => ({ ...f, rr: e.target.value }))} placeholder="(blank ok)" />
                    </label>
                    <label>
                      SpO₂
                      <input inputMode="numeric" value={form.spo2} onChange={(e) => setForm((f) => ({ ...f, spo2: e.target.value }))} placeholder="(blank ok)" />
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
                      <input inputMode="decimal" value={form.tempF} onChange={(e) => setForm((f) => ({ ...f, tempF: e.target.value }))} placeholder="(blank ok)" />
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
    </div>
  )
}
