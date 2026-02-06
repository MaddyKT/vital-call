export type FirefighterStatus = 'duty' | 'rehab' | 'transport'

export type Firefighter = {
  id: string
  firstName: string
  lastName: string
  unit?: string
  status?: FirefighterStatus
}

export type VitalsEntry = {
  id: string
  firefighterId: string
  timestamp: number // epoch ms
  hr?: number
  rr?: number
  spo2?: number
  bpSys?: number
  bpDia?: number
  tempF?: number
  notes?: string
}

export type Scene = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  firefighters: Firefighter[]
  selectedFirefighterId: string | null
  vitals: VitalsEntry[]
}

export type ThemeMode = 'light' | 'dark'

export type Thresholds = {
  hrHigh: number
  hrLow: number
  rrHigh: number
  rrLow: number
  spo2Low: number
  bpSysHigh: number
  bpSysLow: number
  bpDiaHigh: number
  bpDiaLow: number
  tempHighF: number
}

export type Settings = {
  theme: ThemeMode
  thresholds: Thresholds
}

export type AppState = {
  currentSceneId: string | null
  scenes: Scene[]
  settings: Settings
}
