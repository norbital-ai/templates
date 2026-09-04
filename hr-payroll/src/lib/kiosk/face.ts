import Human from '@vladmandic/human';
import {
	KIOSK_ANALYSE_HEIGHT,
	KIOSK_ANALYSE_WIDTH,
	KIOSK_MIN_FACE_PX,
	KIOSK_MODEL_BASE
} from './config.js';
import type { KioskSample } from './sample.js';

type FaceCandidate = Readonly<{
	readonly box?: readonly [number, number, number, number];
	readonly embedding?: number[];
	readonly score: number;
	readonly real?: number;
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
 */
export const warmFaceEngine = async (): Promise<Human> => {
	try {
		const engine = new Human(engineConfig('webgl'));
		await engine.warmup({ face: { enabled: true } });
		return engine;
	} catch {
		const fallback = new Human(engineConfig('wasm'));
		await fallback.warmup({ face: { enabled: true } });
		return fallback;
	}
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
 * One analysed frame: largest face wins, snapshotted for the enrollment preview.
 * Null when no face is in frame — the caller tells the person to move closer.
 */
export const extractFaceSample = async (
	engine: Human,
	video: HTMLVideoElement,
	canvas: HTMLCanvasElement
): Promise<KioskSample | null> => {
	if (!drawVideoFrame(video, canvas)) return null;
	const start = performance.now();
	const result = await engine.detect(canvas);
	const face = largestFace(result.face ?? []);
	if (face === undefined || face.embedding === undefined) return null;
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
		ms: Math.round((performance.now() - start) * 10) / 10
	};
};
