/**
 * Kiosk constants. Thresholds come from the kiosk-probe bench (headless Chromium, fixture
 * faces) and the tablet run that follows it — retune here, in one place, when device numbers land.
 */

/** Workspace key, for the content-addressed model route the compiler serves. */
const KIOSK_WORKSPACE_KEY = 'norbital_hr';

/** Base URL human loads every model json/bin from. Same-origin: no CDN. */
export const KIOSK_MODEL_BASE = `/__bolt/request/api/template-seed-assets/${KIOSK_WORKSPACE_KEY}/models/human`;

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

/** Seconds a matched person has to blink before the challenge expires. */
export const KIOSK_BLINK_WINDOW_S = 6;

/** Faces smaller than this are background, not the person at the kiosk. */
export const KIOSK_MIN_FACE_PX = 80;

/** Enrollment wants this many captures; one is enough to proceed. */
export const KIOSK_ENROLL_SAMPLES = 3;

/** Capture resolution. Bench ran 640x480; the kiosk captures 720p and analyses at 640 wide. */
export const KIOSK_CAPTURE_WIDTH = 1280;
export const KIOSK_CAPTURE_HEIGHT = 720;
export const KIOSK_ANALYSE_WIDTH = 640;
export const KIOSK_ANALYSE_HEIGHT = 480;
