# Vital Call – Firefighter Vitals (Current Scene) (v1)

A simple offline-first web app to track vitals for firefighters during an active incident.

## Features (v1)
- Left panel: roster of firefighters (add/remove)
- Right panel: vitals entry for selected firefighter
- Stores multiple vitals entries per firefighter (timestamped)
- Fields can be left blank
- Export:
  - Share / Export: tries native share (with files) then falls back to downloading CSV + PDF
  - Mailto: opens an email draft (note: mailto can't auto-attach files)

## Run
```bash
cd ~/clawd/fire-vitals
npm install
npm run dev -- --host
```
Then open:
- http://localhost:5173/
- From another device on same Wi‑Fi: http://192.168.40.148:5173/

## Notes
- Data is stored locally in the browser (localStorage) on that device.
- "Clear" wipes the current scene roster + vitals from that device.
