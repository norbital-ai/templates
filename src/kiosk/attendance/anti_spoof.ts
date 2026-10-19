import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import { Effect, Exit, Schema } from 'effect';
import { KIOSK_ASSET_BASE } from './config.js';
import type { FrameSize } from './silhouette.js';

/** MiniVision's inclusive, edge-shifted crop. Keep context around the face for screen/print cues. */
const antiSpoofCrop = (
	image: FrameSize,
	box: readonly [number, number, number, number],
	requestedScale: number
): readonly [number, number, number, number] => {
	const [x, y, width, height] = box;
	const scale = Math.min((image.height - 1) / height, (image.width - 1) / width, requestedScale);
	const cropWidth = width * scale;
	const cropHeight = height * scale;
	const left = Math.max(0, Math.min(image.width - 1 - cropWidth, x + width / 2 - cropWidth / 2));
	const top = Math.max(0, Math.min(image.height - 1 - cropHeight, y + height / 2 - cropHeight / 2));
	return [
		Math.trunc(left),
		Math.trunc(top),
		Math.trunc(left + cropWidth) - Math.trunc(left) + 1,
		Math.trunc(top + cropHeight) - Math.trunc(top) + 1
	];
};

/** Upstream OpenCV input is BGR, float32, 0–255 (its ToTensor deliberately does not divide). */
const antiSpoofPixels = (rgba: Uint8ClampedArray): Float32Array => {
	const pixels = rgba.length / 4;
	const data = new Float32Array(pixels * 3);
	for (const [offset, value] of rgba.entries()) {
		const channel = offset % 4;
		if (channel < 3) data[(2 - channel) * pixels + Math.floor(offset / 4)] = value;
	}
	return data;
};

class AntiSpoofUnavailable extends Schema.TaggedError<AntiSpoofUnavailable>()(
	'AntiSpoofUnavailable',
	{
		message: Schema.String
	}
) {}
const failed = (cause: unknown) => new AntiSpoofUnavailable({ message: String(cause) });
export const releaseAntiSpoof = (session: InferenceSession) =>
	Effect.tryPromise({
		try: () => session.release(),
		catch: failed
	}).pipe(
		Effect.tapCause((cause) => Effect.logWarning('Kiosk anti-spoof release failed', cause)),
		Effect.ignore
	);
const releaseTensor = (tensor: Tensor) =>
	Effect.try({ try: () => tensor.dispose(), catch: failed }).pipe(
		Effect.tapCause((cause) => Effect.logWarning('Kiosk anti-spoof tensor release failed', cause)),
		Effect.ignore
	);
const releasePrediction = (result: Awaited<ReturnType<InferenceSession['run']>>) =>
	Effect.forEach(Object.values(result), releaseTensor, { discard: true });
const infer = (session: InferenceSession, input: Record<string, Tensor>) =>
	Effect.tryPromise({
		try: () => session.run(input),
		catch: failed
	});
export const loadAntiSpoof = Effect.fnUntraced(function* () {
	const model = yield* Effect.try({
		try: () => {
			const base = new URL(`${KIOSK_ASSET_BASE}/models/`, location.origin);
			env.wasm.numThreads = 1;
			env.wasm.wasmPaths = {
				wasm: new URL('ort-wasm-simd-threaded.wasm', base).href,
				mjs: new URL('ort-wasm-simd-threaded.mjs', base).href
			};
			return new URL('minifasnet.onnx', base).href;
		},
		catch: failed
	});
	return yield* Effect.acquireUseRelease(
		Effect.interruptible(
			Effect.tryPromise({
				try: (signal) =>
					InferenceSession.create(model, {
						executionProviders: ['wasm'],
						graphOptimizationLevel: 'all'
					}).then((session) => (signal.aborted ? session.release().then(() => session) : session)),
				catch: failed
			})
		),
		(session) =>
			Effect.acquireUseRelease(
				Effect.try({
					try: () => new Tensor('float32', new Float32Array(3 * 80 * 80), [1, 3, 80, 80]),
					catch: failed
				}),
				(input) =>
					Effect.acquireUseRelease(
						infer(session, { crop27: input, crop4: input }),
						() => Effect.void,
						releasePrediction
					),
				releaseTensor
			).pipe(Effect.as(session)),
		(session, exit) => (Exit.isFailure(exit) ? releaseAntiSpoof(session) : Effect.void)
	);
});
export const scoreAntiSpoof = Effect.fnUntraced(function* (
	session: InferenceSession,
	image: HTMLCanvasElement,
	box: readonly [number, number, number, number],
	crop: HTMLCanvasElement
) {
	const context = yield* Effect.try({
		try: () => crop.getContext('2d', { willReadFrequently: true }),
		catch: failed
	});
	if (context === null) return yield* Effect.fail(failed('Face image could not be read.'));
	return yield* Effect.scoped(
		Effect.gen(function* () {
			const inputs: Tensor[] = [];
			for (const scale of [2.7, 4]) {
				const [x, y, width, height] = antiSpoofCrop(image, box, scale);
				const tensor = yield* Effect.acquireRelease(
					Effect.try({
						try: () => {
							context.drawImage(image, x, y, width, height, 0, 0, 80, 80);
							return new Tensor(
								'float32',
								antiSpoofPixels(context.getImageData(0, 0, 80, 80).data),
								[1, 3, 80, 80]
							);
						},
						catch: failed
					}),
					releaseTensor
				);
				inputs.push(tensor);
			}
			const [crop27, crop4] = inputs;
			if (crop27 === undefined || crop4 === undefined)
				return yield* Effect.fail(failed('Face crops could not be read.'));
			return yield* Effect.acquireUseRelease(
				infer(session, { crop27, crop4 }),
				(result) => {
					const probabilities = result.probabilities;
					if (probabilities === undefined)
						return Effect.fail(failed('Face model returned no probabilities.'));
					// repository-health:allow COERCE1 -- tensor element, a float or bigint from an integer tensor.
					return Effect.succeed(Number(probabilities.data[1]));
				},
				releasePrediction
			);
		})
	);
});
