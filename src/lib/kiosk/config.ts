/**
 * Kiosk constants. Thresholds come from the kiosk-probe bench (headless Chromium, fixture
 * faces) and the tablet run that follows it — retune here, in one place, when device numbers land.
 */

/**
 * Where the face models live, resolved from this chunk's own URL.
 *
 * The `kiosk-face-models` plugin in `vite.config.ts` packages the five model pairs from the pinned
 * Human dependency at `models/human/<name>` beside the `assets/` directory this chunk is built into,
 * so one level up is right wherever the release is served. Colony serves a release's static files
 * only under `/__bolt/static/<tenant>/<environment>/<release>/…`, and the absolute, unversioned
 * `/__bolt/static/models/human` this used to be was a genuine 404 on every hosted tenant: Human
 * logged `error loading model` for iris and antispoof, then `detect` threw from inside its own
 * promise and enrollment never completed. Not `?url` imports: Human loads each `.bin` by the relative
 * name written inside the `.json` weights manifest, and Vite would hash the `.bin` names apart from
 * the manifest. The `@vite-ignore` marks the directory reference as deliberate; Vite leaves it for
 * the browser to resolve.
 */
export const KIOSK_MODEL_BASE = new URL(/* @vite-ignore */ '../models/human/', import.meta.url)
	.href;

/**
 * Where the narration clips live, resolved the same way: the `kiosk-voice-clips` plugin in
 * `vite.config.ts` emits `assets/kiosk-voice/<language>/<key>.mp3` at `kiosk-voice/…` beside the
 * `assets/` directory this chunk is built into.
 */
export const KIOSK_VOICE_BASE = new URL(/* @vite-ignore */ '../kiosk-voice/', import.meta.url).href;

/**
 * The Human model keys the kiosk's configuration enables, as `human.models.loaded()` names them.
 * Every one must be loaded before the scan loop may run: a missing description or iris graph does
 * not fail `load()`, it fails `detect()` on the first face, which is the silence B6 describes.
 */
export const KIOSK_REQUIRED_MODELS: readonly string[] = [
	'blazeface',
	'facemesh',
	'iris',
	'faceres',
	'antispoof',
	'liveness'
];

/** Cosine distance at or below which a probe counts as the enrolled person. */
export const KIOSK_MATCH_THRESHOLD = 0.4;

/**
 * The two presentation-attack scores a punch must clear, from two independent Human graphs.
 *
 * `real` (antispoof) answers "is this a picture of a face?" — print and screen texture. `live`
 * (liveness) answers "is this a *living* face?" — the micro-motion a still or a replayed frame does
 * not have. They fail differently, which is the point: a phone screen bright enough to pass
 * antispoof still reads as low `live`, and a matte print that passes liveness reads as low `real`.
 *
 * This replaces the blink challenge. A blink was never a liveness proof — it is two frames of eye
 * closure, which any recorded video of the enrolled person replays perfectly, and it made the
 * kiosk slower for the honest person and no harder for the dishonest one.
 *
 * Both numbers are tripwires calibrated on the kiosk-probe bench (the probe's genuine web photo
 * scored 0.42 against a synthetic print at 0.63) and both must be re-measured against live captures
 * on the tablet — the physical world does not read like the bench. Retune here, in one place.
 */
export const KIOSK_REAL_MIN = 0.3;
export const KIOSK_LIVE_MIN = 0.5;

/** Frames are analysed this often; the pipeline measures ~60–100 ms warm. */
export const KIOSK_LOOP_MS = 250;

/**
 * Seconds a matched face must stay continuously visible, and passing both presentation-attack
 * scores, before the punch is written. The person does nothing; standing there is the whole
 * confirmation. It also gives the two graphs a run of frames rather than one lucky one.
 */
export const KIOSK_CONFIRMATION_SECONDS = 2;

/** Faces smaller than this are background, not the person at the kiosk. */
export const KIOSK_MIN_FACE_PX = 80;

/** Capture resolution. Bench ran 640x480; the kiosk captures 720p and analyses at 640 wide. */
export const KIOSK_CAPTURE_WIDTH = 1280;
export const KIOSK_CAPTURE_HEIGHT = 720;
export const KIOSK_ANALYSE_WIDTH = 640;
export const KIOSK_ANALYSE_HEIGHT = 480;
