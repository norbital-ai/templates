/**
 * Kiosk constants. Validate model thresholds on the installed camera and its lighting.
 */

/**
 * Where the face models live, resolved from this chunk's own URL.
 *
 * The `kiosk-face-models` plugin in `vite.config.ts` packages the model pairs from the pinned
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
 * Human model keys used by scanning and enrollment, as `human.models.loaded()` names them.
 * The kiosk skips iris; both paths use mesh to keep the recognition input consistent.
 */
export const KIOSK_REQUIRED_MODELS: readonly string[] = [
	'blazeface',
	'facemesh',
	'iris',
	'faceres'
];

/** MiniFASNet's mean real-class probability. Validate this operating point on each camera. */
export const KIOSK_LIVE_MIN = 0.8;

/** No overlapping inference; a busy frame skips the next tick. */
export const KIOSK_LOOP_MS = 100;

/**
 * Seconds the same face must pass liveness inside the outline before the punch is written.
 * Recognition runs during this hold. Standing there is the whole confirmation.
 */
export const KIOSK_CONFIRMATION_SECONDS = 2;

/** Faces smaller than this are background, not the person at the kiosk. */
export const KIOSK_MIN_FACE_PX = 80;

/** Human's returned boxes retain this recognition padding, including when mesh is enabled. */
export const KIOSK_DETECTOR_SCALE = 1.4;

/** Capture resolution. Bench ran 640x480; the kiosk captures 720p and analyses at 640 wide. */
export const KIOSK_CAPTURE_WIDTH = 1280;
export const KIOSK_CAPTURE_HEIGHT = 720;
export const KIOSK_ANALYSE_WIDTH = 640;
export const KIOSK_ANALYSE_HEIGHT = 480;
