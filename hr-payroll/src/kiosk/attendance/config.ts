/**
 * Kiosk constants. Validate model thresholds on the installed camera and its lighting.
 */

/** The workspace's own kiosk assets (narration clips, the anti-spoof export), under its workspace base. */
export const KIOSK_ASSET_BASE = `${typeof document === 'undefined' ? '' : (document.querySelector('meta[name="bolt-base"]')?.getAttribute('content') ?? '')}/assets`;
/**
 * The face models, fetched by the browser from the CDN at the pinned `@vladmandic/human` version (package.json): large
 * models never ship in the release. Human loads each `.bin` by the relative name inside its `.json` weights manifest.
 */
export const KIOSK_MODEL_BASE = 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/models/';

/** The narration clips: `assets/kiosk-voice/<language>/<key>.mp3`; kiosk-voice.test.ts is the gate. */
export const KIOSK_VOICE_BASE = `${KIOSK_ASSET_BASE}/kiosk-voice/`;

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
export const KIOSK_CONFIRMATION_SECONDS = 1;

/** Faces smaller than this are background, not the person at the kiosk. */
export const KIOSK_MIN_FACE_PX = 80;

/** Human's returned boxes retain this recognition padding, including when mesh is enabled. */
export const KIOSK_DETECTOR_SCALE = 1.4;

/** Capture resolution. Bench ran 640x480; the kiosk captures 720p and analyses at 640 wide. */
export const KIOSK_CAPTURE_WIDTH = 1280;
export const KIOSK_CAPTURE_HEIGHT = 720;
export const KIOSK_ANALYSE_WIDTH = 640;
export const KIOSK_ANALYSE_HEIGHT = 480;
