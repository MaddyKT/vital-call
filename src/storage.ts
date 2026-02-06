import type { AppState } from './types'

const KEY = 'fireVitals:v1'

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { firefighters: [], selectedFirefighterId: null, vitals: [] }
    const parsed = JSON.parse(raw) as AppState
    if (!parsed || !Array.isArray(parsed.firefighters) || !Array.isArray(parsed.vitals)) {
      return { firefighters: [], selectedFirefighterId: null, vitals: [] }
    }

    // migration: older versions stored { name, unit }
    const migrated = (parsed.firefighters as any[]).map((f) => {
      // v2+: { firstName, lastName, unit, status }
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

    return { ...parsed, firefighters: migrated as any }
  } catch {
    return { firefighters: [], selectedFirefighterId: null, vitals: [] }
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(KEY, JSON.stringify(state))
}

export function clearState() {
  localStorage.removeItem(KEY)
}
