import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import type { FrameSize } from './silhouette.js';

/** MiniVision's inclusive, edge-shifted crop. Keep context around the face for screen/print cues. */
export const antiSpoofCrop = (
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
export const antiSpoofPixels = (rgba: Uint8ClampedArray): Float32Array => {
	const pixels = rgba.length / 4;
	const data = new Float32Array(pixels * 3);
	for (let i = 0; i < pixels; i++) {
		data[i] = rgba[i * 4 + 2]!;
		data[pixels + i] = rgba[i * 4 + 1]!;
		data[pixels * 2 + i] = rgba[i * 4]!;
	}
	return data;
};

export const loadAntiSpoof = async (): Promise<InferenceSession> => {
	const base = new URL(/* @vite-ignore */ '../models/minifas/', import.meta.url);
	env.wasm.numThreads = 1;
	env.wasm.wasmPaths = {
		wasm: new URL('ort-wasm-simd-threaded.wasm', base).href,
		mjs: new URL('ort-wasm-simd-threaded.mjs', base).href
	};
	const session = await InferenceSession.create(new URL('minifasnet.onnx', base).href, {
		executionProviders: ['wasm'],
		graphOptimizationLevel: 'all'
	});
	const input = new Tensor('float32', new Float32Array(3 * 80 * 80), [1, 3, 80, 80]);
	try {
		const result = await session.run({ crop27: input, crop4: input });
		for (const tensor of Object.values(result)) tensor.dispose();
	} catch (error) {
		await session.release();
		throw error;
	} finally {
		input.dispose();
	}
	return session;
};

export const scoreAntiSpoof = async (
	session: InferenceSession,
	image: HTMLCanvasElement,
	box: readonly [number, number, number, number],
	crop: HTMLCanvasElement
): Promise<number> => {
	const context = crop.getContext('2d', { willReadFrequently: true });
	if (context === null) throw new Error('Face image could not be read.');
	const inputs = [2.7, 4].map((scale) => {
		const [x, y, width, height] = antiSpoofCrop(image, box, scale);
		context.drawImage(image, x, y, width, height, 0, 0, 80, 80);
		return new Tensor(
			'float32',
			antiSpoofPixels(context.getImageData(0, 0, 80, 80).data),
			[1, 3, 80, 80]
		);
	});
	try {
		const result = await session.run({ crop27: inputs[0]!, crop4: inputs[1]! });
		const probabilities = result.probabilities;
		if (probabilities === undefined) throw new Error('Face model returned no probabilities.');
		const score = Number(probabilities.data[1]);
		for (const tensor of Object.values(result)) tensor.dispose();
		return score;
	} finally {
		for (const tensor of inputs) tensor.dispose();
	}
};
