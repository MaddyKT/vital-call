import { useEffect, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import './App.css'
import type { AppState, Firefighter, Scene, Settings, Thresholds, ThemeMode, VitalsEntry } from './types'
import { loadState, saveState } from './storage'
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

function getAlerts(v: VitalsEntry, t: Thresholds): Set<AlertKey> {
  const a = new Set<AlertKey>()

  // Use only if value present.
  if (typeof v.hr === 'number' && (v.hr > t.hrHigh || v.hr < t.hrLow)) a.add('hr')
  if (typeof v.rr === 'number' && (v.rr > t.rrHigh || v.rr < t.rrLow)) a.add('rr')
  if (typeof v.spo2 === 'number' && v.spo2 < t.spo2Low) a.add('spo2')
  if (typeof v.tempF === 'number' && v.tempF > t.tempHighF) a.add('temp')
  if (
    (typeof v.bpSys === 'number' && (v.bpSys > t.bpSysHigh || v.bpSys < t.bpSysLow)) ||
    (typeof v.bpDia === 'number' && (v.bpDia > t.bpDiaHigh || v.bpDia < t.bpDiaLow))
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

  const updateScene = (sceneId: string, fn: (scene: Scene) => Scene) => {
    setState((s) => ({
      ...s,
      scenes: s.scenes.map((sc) => (sc.id === sceneId ? { ...fn(sc), updatedAt: Date.now() } : sc)),
    }))
  }

  const updateSettings = (fn: (settings: Settings) => Settings) => {
    setState((s) => ({ ...s, settings: fn(s.settings) }))
  }

  const updateCurrentScene = (fn: (scene: Scene) => Scene) => {
    if (!state.currentSceneId) return
    updateScene(state.currentSceneId, fn)
  }

  const currentScene: Scene | null = useMemo(() => {
    if (!state.currentSceneId) return null
    return state.scenes.find((s) => s.id === state.currentSceneId) ?? null
  }, [state.currentSceneId, state.scenes])

  const sortedFirefighters = useMemo(() => {
    return (currentScene?.firefighters ?? [])
      .slice()
      .sort((a, b) => (`${a.lastName} ${a.firstName}`.trim()).localeCompare(`${b.lastName} ${b.firstName}`.trim()))
  }, [currentScene?.firefighters])

  const selected = useMemo(() => {
    if (!currentScene) return null
    return currentScene.firefighters.find((f) => f.id === currentScene.selectedFirefighterId) ?? null
  }, [currentScene])

  const selectedVitals = useMemo(() => {
    if (!currentScene || !selected) return []
    return currentScene.vitals
      .filter((v) => v.firefighterId === selected.id)
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [currentScene, selected])

  const [form, setForm] = useState({ timeLocal: '', hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
  const [showNewVitals, setShowNewVitals] = useState(false)
  const [trend, setTrend] = useState<null | { metric: 'hr' | 'rr' | 'spo2' | 'temp' | 'bp' }>(null)
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [newSceneModal, setNewSceneModal] = useState(false)
  const [newSceneName, setNewSceneName] = useState('')

  function nowLocalValue() {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  useEffect(() => {
    // reset form when switching firefighters
    setForm({ timeLocal: nowLocalValue(), hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
    setShowNewVitals(false)
  }, [currentScene?.selectedFirefighterId])

  useEffect(() => {
    if (showNewVitals) {
      setForm((f) => ({ ...f, timeLocal: nowLocalValue() }))
    }
  }, [showNewVitals])

  const [ffModal, setFfModal] = useState<null | { mode: 'add' | 'edit'; id?: string }>(null)
  const [ffForm, setFfForm] = useState({ firstName: '', lastName: '', unit: '', status: '' as '' | 'duty' | 'rehab' | 'transport' })

  const openAddFirefighter = () => {
    setFfForm({ firstName: '', lastName: '', unit: '', status: '' })
    setFfModal({ mode: 'add' })
  }

  const openEditFirefighter = (ff: Firefighter) => {
    setFfForm({ firstName: ff.firstName ?? '', lastName: ff.lastName ?? '', unit: ff.unit ?? '', status: (ff.status ?? '') as any })
    setFfModal({ mode: 'edit', id: ff.id })
  }

  const saveFirefighter = () => {
    const firstName = ffForm.firstName.trim()
    const lastName = ffForm.lastName.trim()
    const unit = ffForm.unit.trim()
    const status = ffForm.status || undefined

    if (!firstName && !lastName) {
      alert('Enter at least a first name or last name.')
      return
    }

    if (!ffModal) return

    if (!currentScene) {
      alert('Start a new scene first.')
      return
    }

    if (ffModal.mode === 'add') {
      const ff: Firefighter = { id: nanoid(), firstName, lastName, unit: unit || undefined, status }
      updateCurrentScene((sc) => ({
        ...sc,
        firefighters: [...sc.firefighters, ff],
        selectedFirefighterId: ff.id,
      }))
      setFfModal(null)
      return
    }

    const id = ffModal.id
    if (!id) return
    updateCurrentScene((sc) => ({
      ...sc,
      firefighters: sc.firefighters.map((f) => (f.id === id ? { ...f, firstName, lastName, unit: unit || undefined, status } : f)),
    }))
    setFfModal(null)
  }

  const removeFirefighter = (id: string) => {
    if (!currentScene) return
    const ff = currentScene.firefighters.find((f) => f.id === id)
    if (!ff) return
    const label = `${ff.lastName}, ${ff.firstName}`.replace(/^,\s*/, '').trim()
    if (!confirm(`Remove ${label} and all their vitals?`)) return

    updateCurrentScene((sc) => {
      const remaining = sc.firefighters.filter((f) => f.id !== id)
      const vitals = sc.vitals.filter((v) => v.firefighterId !== id)
      const selectedFirefighterId = sc.selectedFirefighterId === id ? (remaining[0]?.id ?? null) : sc.selectedFirefighterId
      return { ...sc, firefighters: remaining, vitals, selectedFirefighterId }
    })
  }

  const submitVitals = () => {
    if (!selected) {
      alert('Add/select a firefighter first.')
      return
    }

    const ts = form.timeLocal ? new Date(form.timeLocal).getTime() : Date.now()

    const entry: VitalsEntry = {
      id: nanoid(),
      firefighterId: selected.id,
      timestamp: Number.isFinite(ts) ? ts : Date.now(),
      hr: clampNum(form.hr),
      rr: clampNum(form.rr),
      spo2: clampNum(form.spo2),
      bpSys: clampNum(form.bpSys),
      bpDia: clampNum(form.bpDia),
      tempF: clampNum(form.tempF),
      notes: form.notes.trim() || undefined,
    }

    updateCurrentScene((sc) => ({ ...sc, vitals: [...sc.vitals, entry] }))
    setForm({ timeLocal: nowLocalValue(), hr: '', rr: '', spo2: '', bpSys: '', bpDia: '', tempF: '', notes: '' })
    setShowNewVitals(false)
  }

  const exportAll = async () => {
    if (!currentScene) return
    const safeName = currentScene.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    const baseName = `${safeName || 'vital-call'}-${new Date().toISOString().slice(0, 10)}`

    const csv = exportCsv(currentScene.firefighters, currentScene.vitals)
    const csvBlob = new Blob([csv], { type: 'text/csv' })
    const pdfBlob = exportPdf(currentScene.firefighters, currentScene.vitals)

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
    if (!currentScene) return
    // mailto can't attach files reliably; we open a draft with instructions.
    const subject = encodeURIComponent(`Vital Call Export — ${currentScene.name}`)
    const body = encodeURIComponent(
      `Attached are the vitals exports (CSV + PDF).\n\nTip: if your browser downloaded the files, attach them from Downloads.\n\nExport time: ${new Date().toLocaleString()}`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  const clearCurrentScene = () => {
    if (!currentScene) return
    if (!confirm('Clear current scene roster + vitals on this device?')) return
    updateCurrentScene((sc) => ({ ...sc, firefighters: [], selectedFirefighterId: null, vitals: [] }))
  }

  const deleteScene = (sceneId: string) => {
    const sc = state.scenes.find((x) => x.id === sceneId)
    if (!sc) return
    if (!confirm(`Delete scene “${sc.name}”?`)) return
    setState((s) => {
      const scenes = s.scenes.filter((x) => x.id !== sceneId)
      const currentSceneId = s.currentSceneId === sceneId ? (scenes[0]?.id ?? null) : s.currentSceneId
      return { ...s, scenes, currentSceneId }
    })
  }

  const startNewScene = () => {
    const name = newSceneName.trim() || `Scene ${new Date().toLocaleString()}`
    const id = nanoid()
    const now = Date.now()
    const scene: Scene = {
      id,
      name,
      createdAt: now,
      updatedAt: now,
      firefighters: [],
      selectedFirefighterId: null,
      vitals: [],
    }
    setState((s) => ({ ...s, scenes: [scene, ...s.scenes], currentSceneId: id }))
    setNewSceneModal(false)
    setNewSceneName('')
  }

  // Apply theme
  useEffect(() => {
    const mode: ThemeMode = state.settings?.theme ?? 'light'
    document.documentElement.dataset.theme = mode
  }, [state.settings?.theme])

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="title">Vital Call</div>
          <div className="subtitle">
            {currentScene ? `Scene: ${currentScene.name}` : 'Start a scene to begin tracking vitals'}
          </div>
        </div>
        <div className="topActions">
          {currentScene ? (
            <>
              <button className="btn secondary" onClick={() => setState((s) => ({ ...s, currentSceneId: null }))}>Scenes</button>
              <button className="btn secondary" onClick={() => setShowSettings(true)}>Settings</button>
              <button className="btn" onClick={() => setShowExport(true)}>Export</button>
              <button className="btn danger" onClick={clearCurrentScene}>Clear scene</button>
            </>
          ) : (
            <>
              <button className="btn secondary" onClick={() => setShowSettings(true)}>Settings</button>
              <button className="btn" onClick={() => setNewSceneModal(true)}>+ New Scene</button>
            </>
          )}
        </div>
      </header>

      {currentScene ? (
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
                const last = (currentScene?.vitals ?? [])
                  .filter((v) => v.firefighterId === f.id)
                  .slice()
                  .sort((a, b) => b.timestamp - a.timestamp)[0]

                const isSel = f.id === currentScene?.selectedFirefighterId
                return (
                  <div
                    key={f.id}
                    className={`row ${isSel ? 'selected' : ''} ${f.status ? `status_${f.status}` : ''}`.trim()}
                    onClick={() => updateCurrentScene((sc) => ({ ...sc, selectedFirefighterId: f.id }))}
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

              <div className="statusRow">
                <button
                  className={selected.status === 'duty' ? 'statusBtn statusDuty active' : 'statusBtn statusDuty'}
                  onClick={() => updateCurrentScene((sc) => ({ ...sc, firefighters: sc.firefighters.map((f) => (f.id === selected.id ? { ...f, status: 'duty' } : f)) }))}
                >
                  Return to Duty
                </button>
                <button
                  className={selected.status === 'rehab' ? 'statusBtn statusRehab active' : 'statusBtn statusRehab'}
                  onClick={() => updateCurrentScene((sc) => ({ ...sc, firefighters: sc.firefighters.map((f) => (f.id === selected.id ? { ...f, status: 'rehab' } : f)) }))}
                >
                  Hold for Rehab
                </button>
                <button
                  className={selected.status === 'transport' ? 'statusBtn statusTransport active' : 'statusBtn statusTransport'}
                  onClick={() => updateCurrentScene((sc) => ({ ...sc, firefighters: sc.firefighters.map((f) => (f.id === selected.id ? { ...f, status: 'transport' } : f)) }))}
                >
                  Transport
                </button>
              </div>

              {selectedVitals[0] ? (() => {
                const v = selectedVitals[0]
                const alerts = getAlerts(v, state.settings.thresholds)
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

                <div className="timeHeader">
                  <label className="timeLabel">
                    Time
                    <input
                      className="timeInput"
                      type="datetime-local"
                      value={form.timeLocal}
                      onChange={(e) => setForm((f) => ({ ...f, timeLocal: e.target.value }))}
                    />
                  </label>
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
                const alerts = getAlerts(v, state.settings.thresholds)
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
      ) : (
        <div className="home">
          <div className="panel" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div className="panelTitle">Scenes</div>
                <div className="panelSub">Start a new scene, or open a saved one.</div>
              </div>
              <button className="btn" onClick={() => setNewSceneModal(true)}>+ New Scene</button>
            </div>

            {state.scenes.length === 0 ? (
              <div className="empty">No saved scenes yet.</div>
            ) : (
              <div className="list" style={{ padding: 0, marginTop: 12 }}>
                {state.scenes
                  .slice()
                  .sort((a, b) => b.updatedAt - a.updatedAt)
                  .map((sc) => (
                    <div key={sc.id} className="row" style={{ cursor: 'default' }}>
                      <div className="rowMain">
                        <div className="rowName">{sc.name}</div>
                        <div className="rowMeta">Updated: {new Date(sc.updatedAt).toLocaleString()}</div>
                        <div className="rowMeta">{sc.firefighters.length} firefighters • {sc.vitals.length} vitals</div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button className="btn small" onClick={() => setState((s) => ({ ...s, currentSceneId: sc.id }))}>Open</button>
                        <button className="btn small danger" onClick={() => deleteScene(sc.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="footer">
        <div className="fine">Note: “Mailto” can’t auto-attach files on most devices; use it to open a draft, then attach the downloaded CSV/PDF.</div>
      </footer>

      {showExport && currentScene ? (
        <div className="modalOverlay" onClick={() => setShowExport(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <div className="panelTitle">Export</div>
                <div className="panelSub">{currentScene.name}</div>
              </div>
              <button className="btn secondary" onClick={() => setShowExport(false)}>Close</button>
            </div>

            <div style={{ padding: 14, display: 'grid', gap: 10 }}>
              <button className="btn" onClick={async () => { await exportAll(); setShowExport(false) }}>Share / Export (CSV + PDF)</button>
              <button className="btn secondary" onClick={() => { mailtoExport(); setShowExport(false) }}>Mailto…</button>
            </div>
          </div>
        </div>
      ) : null}

      {showSettings ? (
        <div className="modalOverlay" onClick={() => setShowSettings(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <div className="panelTitle">Settings</div>
                <div className="panelSub">Theme + alert thresholds</div>
              </div>
              <button className="btn secondary" onClick={() => setShowSettings(false)}>Close</button>
            </div>

            <div className="form" style={{ paddingTop: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 12 }}>Theme</div>
                  <div className="fine">{state.settings.theme === 'dark' ? 'Dark mode' : 'Light mode'}</div>
                </div>
                <label className="switch" aria-label="Toggle dark mode">
                  <input
                    type="checkbox"
                    checked={state.settings.theme === 'dark'}
                    onChange={(e) => updateSettings((s) => ({ ...s, theme: e.target.checked ? 'dark' : 'light' }))}
                  />
                  <span className="slider" />
                </label>
              </div>

              <div className="divider" />

              <div className="panelTitle">Thresholds</div>
              <div className="formGrid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <label>
                  HR high
                  <input inputMode="numeric" value={String(state.settings.thresholds.hrHigh)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, hrHigh: Number(e.target.value || 0) } }))} />
                </label>
                <label>
                  HR low
                  <input inputMode="numeric" value={String(state.settings.thresholds.hrLow)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, hrLow: Number(e.target.value || 0) } }))} />
                </label>

                <label>
                  RR high
                  <input inputMode="numeric" value={String(state.settings.thresholds.rrHigh)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, rrHigh: Number(e.target.value || 0) } }))} />
                </label>
                <label>
                  RR low
                  <input inputMode="numeric" value={String(state.settings.thresholds.rrLow)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, rrLow: Number(e.target.value || 0) } }))} />
                </label>

                <label>
                  SpO₂ low
                  <input inputMode="numeric" value={String(state.settings.thresholds.spo2Low)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, spo2Low: Number(e.target.value || 0) } }))} />
                </label>
                <label>
                  Temp high (F)
                  <input inputMode="decimal" value={String(state.settings.thresholds.tempHighF)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, tempHighF: Number(e.target.value || 0) } }))} />
                </label>

                <label>
                  BP sys high
                  <input inputMode="numeric" value={String(state.settings.thresholds.bpSysHigh)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, bpSysHigh: Number(e.target.value || 0) } }))} />
                </label>
                <label>
                  BP sys low
                  <input inputMode="numeric" value={String(state.settings.thresholds.bpSysLow)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, bpSysLow: Number(e.target.value || 0) } }))} />
                </label>

                <label>
                  BP dia high
                  <input inputMode="numeric" value={String(state.settings.thresholds.bpDiaHigh)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, bpDiaHigh: Number(e.target.value || 0) } }))} />
                </label>
                <label>
                  BP dia low
                  <input inputMode="numeric" value={String(state.settings.thresholds.bpDiaLow)} onChange={(e) => updateSettings((s) => ({ ...s, thresholds: { ...s.thresholds, bpDiaLow: Number(e.target.value || 0) } }))} />
                </label>
              </div>

              <div className="fine">Alerts flag values outside the high/low range (SpO₂ flags below its low).</div>
            </div>
          </div>
        </div>
      ) : null}

      {newSceneModal ? (
        <div className="modalOverlay" onClick={() => setNewSceneModal(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modalHeader">
              <div>
                <div className="panelTitle">New Scene</div>
                <div className="panelSub">Create a scene to start tracking vitals</div>
              </div>
              <button className="btn secondary" onClick={() => setNewSceneModal(false)}>Close</button>
            </div>

            <div className="form" style={{ paddingTop: 0 }}>
              <label>
                Scene name
                <input value={newSceneName} onChange={(e) => setNewSceneName(e.target.value)} placeholder="e.g., House fire – Main St" />
              </label>
              <div className="formActions">
                <button className="btn" onClick={startNewScene}>Start</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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

              <label>
                Status (optional)
                <select
                  value={ffForm.status}
                  onChange={(e) => setFfForm((f) => ({ ...f, status: e.target.value as any }))}
                >
                  <option value="">—</option>
                  <option value="duty">Return to Duty</option>
                  <option value="rehab">Hold for Rehab</option>
                  <option value="transport">Transport</option>
                </select>
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
