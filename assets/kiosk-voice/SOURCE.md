# Kiosk voice clips

Recorded by the owner with Gemini TTS on 2026-09-07 from the phrase list in
`src/lib/kiosk/phrases.ts` (MP3, 24 kHz mono), one file per key per language under `en/` and
`zh/`. These files are source material: never regenerate them. `scripts/generate-kiosk-voice.mjs`
only renders a clip for a key that has none, and a key with no clip falls back to browser speech.
Keys without a recording yet: selected_in, selected_out, confirm_in, confirm_out,
no_active_employment, no_arrival, too_soon, unchanged, live_face_required, face_lost,
enroll_no_face.
