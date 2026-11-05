# Kiosk voice clips

Generated on 2026-09-07 with Microsoft Edge's free neural voices (`edge-tts`): en-SG-LunaNeural for
`en/`, zh-CN-XiaoxiaoNeural for `zh/`, both female, at +15% speaking rate. One MP3 per key per
language, keyed by the phrase list in `src/kiosk/attendance/phrases.ts`.

The kiosk never uses a system or browser voice: a key with no clip is silent. After any copy change
in `phrases.ts`, re-render the affected clips with `edge-tts` at the same voice and rate, and delete
the clip of a removed key.
