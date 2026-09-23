import { Effect } from 'effect';

/**
 * Sealed-artifact path written by `vite.config.ts` `serverAssets`. The isolate host copies that
 * sidecar into the guest. Node tests install the same reader from their test-only preload.
 */
const PDQ_WASM_ASSET = 'node_modules/pdq-wasm/wasm/pdq.wasm';

/**
 * pdq-wasm 0.3.9 emscripten export map. The published JS glue `require`s `node:module` / `fs`,
 * which the tenant isolate denies — so this file instantiates the sidecar WASM directly.
 */
const PDQ_EXPORT = {
	memory: 'd',
	init: 'e',
	hashFromRgb: 'f',
	malloc: 'k',
	free: 'l'
} as const;

type ArtifactReadBytes = {
	applySync(
		receiver: undefined,
		args: readonly [string],
		options: {
			readonly arguments: { readonly copy: true };
			readonly result: { readonly copy: true };
		}
	): Uint8Array<ArrayBuffer> | ArrayBuffer | null;
};

type PdqWasmExports = {
	readonly [PDQ_EXPORT.memory]: WebAssembly.Memory;
	readonly [PDQ_EXPORT.init]: () => void;
	readonly [PDQ_EXPORT.hashFromRgb]: (
		imagePtr: number,
		width: number,
		height: number,
		hashPtr: number,
		qualityPtr: number
	) => number;
	readonly [PDQ_EXPORT.malloc]: (size: number) => number;
	readonly [PDQ_EXPORT.free]: (ptr: number) => void;
};

/** A decoded raster: RGB, or RGBA whose alpha is dropped on its way into the WASM heap. */
type PdqHashInput = {
	readonly data: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly channels: 3 | 4;
};

/** Load the 0.3.9 WASM sidecar from the sealed artifact reader supplied by the host. */
function readPdqWasmBytes(): Uint8Array<ArrayBuffer> {
	const reader = (globalThis as typeof globalThis & { __artifactReadBytes?: ArtifactReadBytes })
		.__artifactReadBytes;
	if (!reader) throw new Error('Sealed runtime artifact reader is unavailable');
	const bytes = reader.applySync(undefined, [PDQ_WASM_ASSET], {
		arguments: { copy: true },
		result: { copy: true }
	});
	if (bytes == null) throw new Error(`Sealed runtime is missing ${PDQ_WASM_ASSET}`);
	return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * Wasm-side memory growth helper. Called from the emscripten import `c`, which the WASM runtime
 * invokes synchronously; a failed grow is reported back in the return value, not as an exception.
 */
function growMemory(memory: WebAssembly.Memory, requestedSize: number): number {
	const oldSize = memory.buffer.byteLength;
	const needed = requestedSize >>> 0;
	if (needed <= oldSize) return 1;
	try {
		memory.grow(Math.max(Math.ceil((needed - oldSize) / 65536), 1));
		return 1;
	} catch {
		return 0;
	}
}

/**
 * The emscripten import table, called synchronously by the WASM runtime. A trap has to unwind
 * through the WASM frame, so `abort` throws and the `Effect.try` around every entry into this
 * module turns that back into a typed failure. `boundMemory` is read per call because the memory
 * only exists once the instance does.
 */
function pdqImports(boundMemory: () => WebAssembly.Memory | undefined) {
	return {
		a: (buffer: number, size: number) => {
			const memory = boundMemory();
			if (!memory) throw new Error('pdq-wasm memory is not bound');
			crypto.getRandomValues(new Uint8Array(memory.buffer, buffer, size));
			return 0;
		},
		b: () => {
			throw new Error('pdq-wasm aborted');
		},
		c: (requestedSize: number) => {
			const memory = boundMemory();
			if (!memory) return 0;
			return growMemory(memory, requestedSize);
		}
	};
}

/**
 * Compile the sidecar once per isolate / Node process.
 *
 * Synchronously: isolated-vm never settles `WebAssembly.compile`/`instantiate`'s promises, so the
 * async API hangs the guest invocation until its deadline. The module is 25 KB.
 */
const loadPdq = Effect.runSync(
	Effect.cached(
		Effect.try(() => {
			let memory: WebAssembly.Memory | undefined;
			const instance = new WebAssembly.Instance(new WebAssembly.Module(readPdqWasmBytes()), {
				a: pdqImports(() => memory)
			});
			const exports = instance.exports as PdqWasmExports;
			memory = exports[PDQ_EXPORT.memory];
			exports[PDQ_EXPORT.init]();
			return exports;
		})
	)
);

/**
 * The longest side PDQ is handed. PDQ reduces every image to 64×64 itself, so a 12 MP raster only
 * buys CPU: at full resolution the hash alone cost ~500 ms of the guest's 2 s budget. Larger
 * rasters are box-averaged by an integer factor on their way into the WASM heap.
 */
const PDQ_MAX_SIDE = 512;

/**
 * Write `image` into `heap` as RGB, box-averaging `factor`×`factor` blocks (trailing partial
 * blocks are dropped). One pass over the source, and no intermediate full-resolution copy.
 */
function writeRgb(image: PdqHashInput, factor: number, heap: Uint8Array, width: number): void {
	const { data, channels } = image;
	if (factor === 1) {
		if (channels === 3) heap.set(data);
		else
			for (let i = 0, j = 0; j < heap.length; i += 4, j += 3) {
				heap[j] = data[i]!;
				heap[j + 1] = data[i + 1]!;
				heap[j + 2] = data[i + 2]!;
			}
		return;
	}
	const sums = new Uint32Array(width * 3);
	const rowStride = image.width * channels;
	const area = factor * factor;
	for (let outY = 0, y = 0; y + factor <= image.height; outY += 1) {
		sums.fill(0);
		for (let row = 0; row < factor; row += 1, y += 1) {
			let i = y * rowStride;
			for (let s = 0; s < sums.length; s += 3) {
				for (let k = 0; k < factor; k += 1, i += channels) {
					sums[s] += data[i]!;
					sums[s + 1] += data[i + 1]!;
					sums[s + 2] += data[i + 2]!;
				}
			}
		}
		const offset = outY * width * 3;
		for (let s = 0; s < sums.length; s += 1) heap[offset + s] = Math.round(sums[s]! / area);
	}
}

/** Hash a raster with Meta PDQ and return the 32-byte digest plus quality. */
export const hashPdq = (image: PdqHashInput) =>
	Effect.gen(function* () {
		const loaded = yield* loadPdq;
		if (image.data.length !== image.width * image.height * image.channels) {
			return yield* Effect.fail(
				new Error(
					`Invalid image data size. Expected ${image.width * image.height * image.channels} bytes, got ${image.data.length}`
				)
			);
		}
		const factor = Math.max(1, Math.ceil(Math.max(image.width, image.height) / PDQ_MAX_SIDE));
		const width = Math.floor(image.width / factor);
		const height = Math.floor(image.height / factor);
		const malloc = loaded[PDQ_EXPORT.malloc];
		const free = loaded[PDQ_EXPORT.free];
		return yield* Effect.acquireUseRelease(
			Effect.try(() => ({
				imagePtr: malloc(width * height * 3),
				hashPtr: malloc(32),
				qualityPtr: malloc(4)
			})),
			({ imagePtr, hashPtr, qualityPtr }) =>
				Effect.try(() => {
					writeRgb(
						image,
						factor,
						new Uint8Array(loaded[PDQ_EXPORT.memory].buffer, imagePtr, width * height * 3),
						width
					);
					const status = loaded[PDQ_EXPORT.hashFromRgb](
						imagePtr,
						width,
						height,
						hashPtr,
						qualityPtr
					);
					if (status !== 0) throw new Error(`PDQ hashing failed with code: ${status}`);
					// Re-read the buffer: hashing may have grown (and so detached) the memory.
					const buffer = loaded[PDQ_EXPORT.memory].buffer;
					return {
						hash: new Uint8Array(buffer).slice(hashPtr, hashPtr + 32),
						quality: new Int32Array(buffer)[qualityPtr >> 2]!
					};
				}),
			({ imagePtr, hashPtr, qualityPtr }) =>
				Effect.sync(() => {
					free(imagePtr);
					free(hashPtr);
					free(qualityPtr);
				})
		);
	});

/** Encode a 32-byte digest (PDQ or SHA-256) as the 64-char hex stored on `photo_evidence`. */
export function digestToHex(hash: Uint8Array): string {
	if (hash.length !== 32) {
		throw new Error(`Digests must be 32 bytes (got ${hash.length})`);
	}
	return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
