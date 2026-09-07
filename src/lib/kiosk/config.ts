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
 * The Human model keys the kiosk's configuration enables, as `human.models.loaded()` names them.
 * Every one must be loaded before the scan loop may run: a missing description or iris graph does
 * not fail `load()`, it fails `detect()` on the first face, which is the silence B6 describes.
 */
export const KIOSK_REQUIRED_MODELS: readonly string[] = [
	'blazeface',
	'facemesh',
	'iris',
	'faceres',
	'antispoof'
];

/** Cosine distance at or below which a probe counts as the enrolled person. */
export const KIOSK_MATCH_THRESHOLD = 0.4;

/**
 * Minimum antispoof `real` score to reach the blink challenge. The probe's genuine web photo
 * scored 0.42 against a synthetic print at 0.63, so this is a tripwire for naive paper, not a
 * verdict — the blink is the verdict. Recalibrate against live captures on the tablet.
 */
export const KIOSK_REAL_MIN = 0.3;

/** Frames are analysed this often; the pipeline measures ~60–100 ms warm. */
export const KIOSK_LOOP_MS = 250;

/** Seconds allowed for a continuously visible face to acknowledge the punch with a blink. */
export const KIOSK_CONFIRMATION_SECONDS = 2;

/** Faces smaller than this are background, not the person at the kiosk. */
export const KIOSK_MIN_FACE_PX = 80;

/** Enrollment wants this many captures; one is enough to proceed. */
export const KIOSK_ENROLL_SAMPLES = 3;

/** Capture resolution. Bench ran 640x480; the kiosk captures 720p and analyses at 640 wide. */
export const KIOSK_CAPTURE_WIDTH = 1280;
export const KIOSK_CAPTURE_HEIGHT = 720;
export const KIOSK_ANALYSE_WIDTH = 640;
export const KIOSK_ANALYSE_HEIGHT = 480;
