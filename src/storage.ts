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
    return parsed
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
