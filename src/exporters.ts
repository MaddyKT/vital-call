import type { Firefighter, VitalsEntry } from './types'
import Papa from 'papaparse'
import { jsPDF } from 'jspdf'

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString()
}

export function exportCsv(firefighters: Firefighter[], vitals: VitalsEntry[]) {
  const ffById = new Map(firefighters.map((f) => [f.id, f]))

  const rows = vitals
    .slice()
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((v) => {
      const f = ffById.get(v.firefighterId)
      return {
        time: fmtTime(v.timestamp),
        firefighter: f?.name ?? 'Unknown',
        unit: f?.unit ?? '',
        hr: v.hr ?? '',
        rr: v.rr ?? '',
        spo2: v.spo2 ?? '',
        bpSys: v.bpSys ?? '',
        bpDia: v.bpDia ?? '',
        tempF: v.tempF ?? '',
        notes: v.notes ?? '',
      }
    })

  const csv = Papa.unparse(rows)
  return csv
}

export function exportPdf(firefighters: Firefighter[], vitals: VitalsEntry[]) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const margin = 40
  let y = margin

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Firefighter Vitals – Current Scene', margin, y)
  y += 18

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(`Exported: ${new Date().toLocaleString()}`, margin, y)
  y += 20

  const grouped = new Map<string, VitalsEntry[]>()
  for (const v of vitals) {
    const arr = grouped.get(v.firefighterId) ?? []
    arr.push(v)
    grouped.set(v.firefighterId, arr)
  }

  const ffList = firefighters.slice().sort((a, b) => a.name.localeCompare(b.name))

  for (const f of ffList) {
    const entries = (grouped.get(f.id) ?? []).slice().sort((a, b) => b.timestamp - a.timestamp)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    const header = `${f.name}${f.unit ? ` (${f.unit})` : ''}`
    if (y > 740) {
      doc.addPage()
      y = margin
    }
    doc.text(header, margin, y)
    y += 14

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)

    if (entries.length === 0) {
      doc.text('No vitals recorded.', margin, y)
      y += 14
      continue
    }

    for (const v of entries) {
      if (y > 740) {
        doc.addPage()
        y = margin
      }

      const line1 = `${fmtTime(v.timestamp)}  HR:${v.hr ?? '-'} RR:${v.rr ?? '-'} SpO₂:${v.spo2 ?? '-'} BP:${v.bpSys ?? '-'} / ${v.bpDia ?? '-'} TempF:${v.tempF ?? '-'}`
      doc.text(line1, margin, y)
      y += 12
      if (v.notes?.trim()) {
        const wrapped = doc.splitTextToSize(`Notes: ${v.notes.trim()}`, 520)
        doc.text(wrapped, margin, y)
        y += wrapped.length * 12
      }
    }

    y += 10
  }

  return doc.output('blob')
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: mime }), filename)
}

export async function shareFilesIfPossible(files: File[], title: string) {
  // Web Share API Level 2 (file share) is supported on iOS Safari/Chrome and some desktop browsers.
  // Fallback handled by caller.
  // @ts-ignore
  if (navigator?.canShare && navigator.canShare({ files }) && navigator.share) {
    await navigator.share({ title, files })
    return true
  }
  return false
}
