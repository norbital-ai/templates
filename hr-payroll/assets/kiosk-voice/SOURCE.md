# Kiosk voice clips

Generated on 2026-09-07 by `scripts/generate-kiosk-voice.mjs` with Microsoft Edge's free neural
voices (`edge-tts`): en-SG-LunaNeural for `en/`, zh-CN-XiaoxiaoNeural for `zh/`, both female, at
+15% speaking rate. One MP3 per key per language, keyed by the phrase list in
`src/lib/kiosk/phrases.ts`.

The kiosk never uses a system or browser voice: a key with no clip is silent. After any copy change
in phrases.ts, re-render the affected clips:

    node scripts/generate-kiosk-voice.mjs --force

Needs `python3 -m pip install edge-tts` once. A stale clip for a removed key is deleted by the same
script.
