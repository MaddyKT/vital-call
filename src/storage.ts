import type { AppState, Scene, Settings } from './types'

const KEY_V2 = 'vitalCall:v2'
const KEY_V1 = 'fireVitals:v1'

const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  thresholds: {
    hrHigh: 100,
    hrLow: 50,
    rrHigh: 30,
    rrLow: 8,
    spo2Low: 92,
    bpSysHigh: 180,
    bpSysLow: 90,
    bpDiaHigh: 110,
    bpDiaLow: 60,
    tempHighF: 101.0,
  },
}

function migrateFirefighters(firefighters: any[]) {
  return (firefighters ?? []).map((f) => {
    if ('firstName' in (f as any) && 'lastName' in (f as any)) {
      const status = (f as any).status
      const ok = status === 'duty' || status === 'rehab' || status === 'transport'
      return ok ? f : { ...f, status: undefined }
    }
    const name = String((f as any).name ?? '').trim()
    const unit = (f as any).unit
    const parts = name.split(/\s+/).filter(Boolean)
    const firstName = parts[0] ?? ''
    const lastName = parts.slice(1).join(' ')
    return { id: (f as any).id, firstName, lastName, unit }
  })
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY_V2)
    if (raw) {
      const parsed = JSON.parse(raw) as AppState
      if (parsed && Array.isArray(parsed.scenes)) {
        return {
          ...parsed,
          settings: parsed.settings ?? DEFAULT_SETTINGS,
        }
      }
    }

    // Migration from v1 single-scene state
    const rawV1 = localStorage.getItem(KEY_V1)
    if (rawV1) {
      const v1 = JSON.parse(rawV1) as any
      if (v1 && Array.isArray(v1.firefighters) && Array.isArray(v1.vitals)) {
        const now = Date.now()
        const scene: Scene = {
          id: 'scene_migrated',
          name: 'Current Scene',
          createdAt: now,
          updatedAt: now,
          firefighters: migrateFirefighters(v1.firefighters),
          selectedFirefighterId: v1.selectedFirefighterId ?? null,
          vitals: v1.vitals,
        }
        const next: AppState = { currentSceneId: scene.id, scenes: [scene], settings: DEFAULT_SETTINGS }
        saveState(next)
        return next
      }
    }

    return { currentSceneId: null, scenes: [], settings: DEFAULT_SETTINGS }
  } catch {
    return { currentSceneId: null, scenes: [], settings: DEFAULT_SETTINGS }
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY_V2, JSON.stringify(state))
}

export function clearAll() {
  localStorage.removeItem(KEY_V2)
  localStorage.removeItem(KEY_V1)
}
