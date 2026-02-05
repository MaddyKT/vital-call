export type Firefighter = {
  id: string
  firstName: string
  lastName: string
  unit?: string
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

export type AppState = {
  firefighters: Firefighter[]
  selectedFirefighterId: string | null
  vitals: VitalsEntry[]
}
