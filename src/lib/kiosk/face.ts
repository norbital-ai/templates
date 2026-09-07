import Human from '@vladmandic/human';
import {
	KIOSK_ANALYSE_HEIGHT,
	KIOSK_ANALYSE_WIDTH,
	KIOSK_MIN_FACE_PX,
	KIOSK_MODEL_BASE,
	KIOSK_REQUIRED_MODELS
} from './config.js';
import type { KioskSample } from './sample.js';

type FaceCandidate = Readonly<{
	readonly box?: readonly [number, number, number, number];
	readonly embedding?: number[];
	readonly score: number;
	readonly real?: number;
	/** Head pose in radians, from the mesh; absent until the mesh graph has run on this face. */
	readonly rotation?: Readonly<{ angle: Readonly<{ yaw: number; pitch: number }> }> | null;
}>;

const engineConfig = (backend: 'webgl' | 'wasm') => ({
	backend,
	modelBasePath: KIOSK_MODEL_BASE,
	debug: false,
	warmup: 'none' as const,
	cacheModels: true,
	async: false,
	face: {
		enabled: true,
		detector: {
			modelPath: 'blazeface.json',
			rotation: false,
			maxDetected: 3,
			minConfidence: 0.2,
			minSize: KIOSK_MIN_FACE_PX,
			scale: 1.4,
			skipFrames: 0,
			skipTime: 0
		},
		description: {
			enabled: true,
			modelPath: 'faceres.json',
			minConfidence: 0.2,
			skipFrames: 0,
			skipTime: 0
		},
		antispoof: { enabled: true, modelPath: 'antispoof.json', skipFrames: 0, skipTime: 0 },
		iris: { enabled: true, modelPath: 'iris.json' },
		mesh: { enabled: true, modelPath: 'facemesh.json' },
		emotion: { enabled: false },
		attention: { enabled: false },
		liveness: { enabled: false },
		gear: { enabled: false }
	},
	hand: { enabled: false },
	body: { enabled: false },
	object: { enabled: false },
	gesture: { enabled: true }
});

/**
 * Warms one face engine: WebGL first, WASM when the tablet has no usable GPU. Each
 * surface owns its instance — the kiosk owns one for the scan loop, the HR photo
 * dialog owns one while it is open — so unmount cleanup never resets a shared engine.
 *
 * `load()` is explicit: with `warmup: 'none'` Human's `warmup()` returns before loading anything,
 * so the graphs used to arrive lazily on the first `detect`, where a missing one threw from inside
 * Human's own promise. Loading here is what lets `missingFaceModels` answer before the loop starts.
 * A model that fails to load does not reject `load()`; Human logs it and leaves the slot empty.
 */
export const warmFaceEngine = async (): Promise<Human> => {
	const boot = async (backend: 'webgl' | 'wasm'): Promise<Human> => {
		const engine = new Human(engineConfig(backend));
		await engine.load();
		await engine.warmup({ face: { enabled: true } });
		return engine;
	};
	try {
		return await boot('webgl');
	} catch {
		return await boot('wasm');
	}
};

/**
 * The enabled models the engine did not load, in `KIOSK_REQUIRED_MODELS` order. Empty means the
 * engine may run; anything else means the kiosk says "Face engine unavailable" and never scans.
 */
export const missingFaceModels = (engine: Human): string[] => {
	const loaded = new Set(engine.models.loaded());
	return KIOSK_REQUIRED_MODELS.filter((name) => !loaded.has(name));
};

/**
 * Puts a live stream on a video node and starts playback. Both camera surfaces — the
 * kiosk videos and the HR photo dialog — call this in two places: boot, for the node the
 * attachment already holds, and the attachment itself, for the stream boot already holds.
 * Whichever lands second wins, so mount order stops mattering and no effect is needed.
 */
export const showStream = (node: HTMLVideoElement, stream: MediaStream | null): void => {
	if (node.srcObject !== stream) node.srcObject = stream;
	if (stream !== null) void node.play().catch(() => {});
};

/** One analyse frame buffer per caller. Created lazily so module import never touches DOM. */
export const createAnalyseCanvas = (): HTMLCanvasElement => {
	const canvas = document.createElement('canvas');
	canvas.width = KIOSK_ANALYSE_WIDTH;
	canvas.height = KIOSK_ANALYSE_HEIGHT;
	return canvas;
};

/** Copies the live video frame into the analyse buffer. False while the camera is warming. */
export const drawVideoFrame = (video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean => {
	if (video.readyState < 2 || video.videoWidth === 0) return false;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (ctx === null) return false;
	const shrink = Math.min(
		KIOSK_ANALYSE_WIDTH / video.videoWidth,
		KIOSK_ANALYSE_HEIGHT / video.videoHeight,
		1
	);
	const dw = video.videoWidth * shrink;
	const dh = video.videoHeight * shrink;
	ctx.drawImage(video, (KIOSK_ANALYSE_WIDTH - dw) / 2, (KIOSK_ANALYSE_HEIGHT - dh) / 2, dw, dh);
	return true;
};

/** Largest face wins — the same rule for the scan loop and every enrollment capture. */
export const largestFace = (faces: ReadonlyArray<FaceCandidate>): FaceCandidate | undefined => {
	let best: FaceCandidate | undefined;
	let bestSize = 0;
	for (const face of faces) {
		const size = (face.box?.[2] ?? 0) * (face.box?.[3] ?? 0);
		if (size > bestSize) {
			bestSize = size;
			best = face;
		}
	}
	return best;
};

/**
 * The sample for a face the engine has already read from `canvas`: the frame snapshotted for the
 * enrollment preview and the photo, beside the descriptor. Null when the face carries no
 * embedding, which is a face too small or turned too far for the description graph.
 */
export const sampleFromFace = (
	face: FaceCandidate,
	canvas: HTMLCanvasElement,
	ms: number
): KioskSample | null => {
	if (face.embedding === undefined) return null;
	const snapshot = document.createElement('canvas');
	snapshot.width = canvas.width;
	snapshot.height = canvas.height;
	snapshot.getContext('2d')?.drawImage(canvas, 0, 0);
	return {
		canvas: snapshot,
		dataUrl: snapshot.toDataURL('image/jpeg', 0.7),
		vector: [...face.embedding],
		score: Math.round(face.score * 100) / 100,
		box: `${Math.round(face.box?.[2] ?? 0)}x${Math.round(face.box?.[3] ?? 0)}`,
		ms: Math.round(ms * 10) / 10
	};
};
