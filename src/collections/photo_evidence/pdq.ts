import { readFile as readFileAsync } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect, Exit, Schema } from 'effect';

/**
 * Sealed-artifact path written by `vite.config.ts` `serverAssets`. The isolate host copies that
 * sidecar into the guest; Node tests walk up from this module to the template `node_modules`.
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
	): Uint8Array | ArrayBuffer | null;
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

const pdqHashInputSchema = Schema.Struct({
	data: Schema.Uint8Array,
	width: Schema.Int,
	height: Schema.Int,
	channels: Schema.Literal(3)
});

type PdqHashInput = Schema.Schema.Type<typeof pdqHashInputSchema>;

const pdqHashResultSchema = Schema.Struct({
	hash: Schema.Uint8Array,
	quality: Schema.Int
});

const decodeWasmMemory = Schema.decodeUnknownSync(Schema.instanceOf(WebAssembly.Memory));
const decodeWasmFunction = Schema.decodeUnknownSync(Schema.instanceOf(Function));
const decodeWasmNumber = Schema.decodeUnknownSync(Schema.Number);

function artifactReader(): ArtifactReadBytes | null {
	const reader = (globalThis as typeof globalThis & { __artifactReadBytes?: ArtifactReadBytes })
		.__artifactReadBytes;
	return reader ?? null;
}

/** Load the 0.3.9 WASM sidecar from the sealed artifact, or from the template install in Node. */
function readPdqWasmBytes() {
	const reader = artifactReader();
	if (reader) {
		return Effect.try(() => {
			const bytes = reader.applySync(undefined, [PDQ_WASM_ASSET], {
				arguments: { copy: true },
				result: { copy: true }
			});
			if (bytes == null) {
				throw new Error(`Sealed runtime is missing ${PDQ_WASM_ASSET}`);
			}
			return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		});
	}
	return Effect.gen(function* () {
		let directory = dirname(fileURLToPath(import.meta.url));
		for (let depth = 0; depth < 8; depth += 1) {
			const candidate = join(directory, PDQ_WASM_ASSET);
			const bytes = yield* Effect.tryPromise(() => readFileAsync(candidate)).pipe(
				Effect.orElseSucceed(() => null)
			);
			if (bytes != null) return new Uint8Array(bytes);
			const parent = dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		return yield* Effect.fail(new Error(`pdq-wasm sidecar is not installed at ${PDQ_WASM_ASSET}`));
	});
}

/**
 * Wasm-side memory growth helper. Called from the emscripten import `c`, which the WASM runtime
 * invokes synchronously, so it must stay a plain function; a failed grow is reported back in the
 * return value rather than as an exception.
 */
function growMemory(memory: WebAssembly.Memory, requestedSize: number): number {
	const oldSize = memory.buffer.byteLength;
	const needed = requestedSize >>> 0;
	if (needed <= oldSize) return 1;
	const grown = Effect.runSyncExit(
		Effect.try(() => memory.grow(Math.max(Math.ceil((needed - oldSize) / 65536), 1)))
	);
	return Exit.isSuccess(grown) ? 1 : 0;
}

function assertPdqExports(exports: WebAssembly.Exports): PdqWasmExports {
	const memory = decodeWasmMemory(exports[PDQ_EXPORT.memory]);
	const init = decodeWasmFunction(exports[PDQ_EXPORT.init]);
	const hashFromRgb = decodeWasmFunction(exports[PDQ_EXPORT.hashFromRgb]);
	const malloc = decodeWasmFunction(exports[PDQ_EXPORT.malloc]);
	const free = decodeWasmFunction(exports[PDQ_EXPORT.free]);
	return {
		[PDQ_EXPORT.memory]: memory,
		[PDQ_EXPORT.init]: () => {
			Reflect.apply(init, undefined, []);
		},
		[PDQ_EXPORT.hashFromRgb]: (imagePtr, width, height, hashPtr, qualityPtr) =>
			decodeWasmNumber(
				Reflect.apply(hashFromRgb, undefined, [imagePtr, width, height, hashPtr, qualityPtr])
			),
		[PDQ_EXPORT.malloc]: (size) => decodeWasmNumber(Reflect.apply(malloc, undefined, [size])),
		[PDQ_EXPORT.free]: (ptr) => {
			Reflect.apply(free, undefined, [ptr]);
		}
	} satisfies PdqWasmExports;
}

/** Compile the sidecar once per isolate / Node process. */
const loadPdq = Effect.runSync(
	Effect.cached(
		Effect.gen(function* () {
			const bytes = yield* readPdqWasmBytes();
			const wasm = new Uint8Array(bytes.byteLength);
			wasm.set(bytes);
			let memory: WebAssembly.Memory | undefined;
			const compiled = yield* Effect.tryPromise(() => WebAssembly.compile(wasm.buffer));
			const instance = yield* Effect.tryPromise(() =>
				WebAssembly.instantiate(compiled, {
					a: {
						a: (buffer: number, size: number) => {
							if (!memory) throw new Error('pdq-wasm memory is not bound');
							crypto.getRandomValues(new Uint8Array(memory.buffer, buffer, size));
							return 0;
						},
						b: () => {
							throw new Error('pdq-wasm aborted');
						},
						c: (requestedSize: number) => {
							if (!memory) return 0;
							return growMemory(memory, requestedSize);
						}
					}
				})
			);
			const loaded = yield* Effect.try(() => assertPdqExports(instance.exports));
			memory = loaded[PDQ_EXPORT.memory];
			yield* Effect.try(() => loaded[PDQ_EXPORT.init]());
			return loaded;
		})
	)
);

/** Hash an RGB raster with Meta PDQ and return the 32-byte digest plus quality. */
export const hashPdq = (image: PdqHashInput) =>
	Effect.gen(function* () {
		const loaded = yield* loadPdq;
		const expected = image.width * image.height * image.channels;
		if (image.data.length !== expected) {
			return yield* Effect.fail(
				new Error(`Invalid image data size. Expected ${expected} bytes, got ${image.data.length}`)
			);
		}
		const malloc = loaded[PDQ_EXPORT.malloc];
		const free = loaded[PDQ_EXPORT.free];
		const imagePtr = malloc(image.data.length);
		const hashPtr = malloc(32);
		const qualityPtr = malloc(4);
		return yield* Effect.acquireUseRelease(
			Effect.succeed({ imagePtr, hashPtr, qualityPtr }),
			() =>
				Effect.try(() => {
					new Uint8Array(loaded[PDQ_EXPORT.memory].buffer).set(image.data, imagePtr);
					const status = loaded[PDQ_EXPORT.hashFromRgb](
						imagePtr,
						image.width,
						image.height,
						hashPtr,
						qualityPtr
					);
					if (status !== 0) {
						throw new Error(`PDQ hashing failed with code: ${status}`);
					}
					const heap = new Uint8Array(loaded[PDQ_EXPORT.memory].buffer);
					return {
						hash: heap.slice(hashPtr, hashPtr + 32),
						quality: new Int32Array(loaded[PDQ_EXPORT.memory].buffer)[qualityPtr >> 2]
					};
				}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(pdqHashResultSchema))),
			(ptrs) =>
				Effect.try(() => {
					free(ptrs.imagePtr);
					free(ptrs.hashPtr);
					free(ptrs.qualityPtr);
				})
		);
	});

/** Encode a 32-byte PDQ digest as the 64-char hex stored on `photo_evidence`. */
export function pdqHashToHex(hash: Uint8Array): string {
	if (hash.length !== 32) {
		throw new Error(`PDQ hashes must be 32 bytes (got ${hash.length})`);
	}
	return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
