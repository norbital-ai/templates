import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export type PdqHashInput = {
	readonly data: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly channels: 3;
};

export type PdqHashResult = {
	readonly hash: Uint8Array;
	readonly quality: number;
};

let modulePromise: Promise<PdqWasmExports> | null = null;

function artifactReader(): ArtifactReadBytes | null {
	const reader = (globalThis as typeof globalThis & { __artifactReadBytes?: ArtifactReadBytes })
		.__artifactReadBytes;
	return reader ?? null;
}

/** Load the 0.3.9 WASM sidecar from the sealed artifact, or from the template install in Node. */
function readPdqWasmBytes(): Uint8Array {
	const reader = artifactReader();
	if (reader) {
		const bytes = reader.applySync(undefined, [PDQ_WASM_ASSET], {
			arguments: { copy: true },
			result: { copy: true }
		});
		if (bytes == null) {
			throw new Error(`Sealed runtime is missing ${PDQ_WASM_ASSET}`);
		}
		return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	}
	let directory = dirname(fileURLToPath(import.meta.url));
	for (let depth = 0; depth < 8; depth += 1) {
		const candidate = join(directory, PDQ_WASM_ASSET);
		if (existsSync(candidate)) return new Uint8Array(readFileSync(candidate));
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	throw new Error(`pdq-wasm sidecar is not installed at ${PDQ_WASM_ASSET}`);
}

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

function assertPdqExports(exports: WebAssembly.Exports): PdqWasmExports {
	const memory = exports[PDQ_EXPORT.memory];
	const init = exports[PDQ_EXPORT.init];
	const hashFromRgb = exports[PDQ_EXPORT.hashFromRgb];
	const malloc = exports[PDQ_EXPORT.malloc];
	const free = exports[PDQ_EXPORT.free];
	if (
		!(memory instanceof WebAssembly.Memory) ||
		typeof init !== 'function' ||
		typeof hashFromRgb !== 'function' ||
		typeof malloc !== 'function' ||
		typeof free !== 'function'
	) {
		throw new Error('pdq-wasm 0.3.9 export map is missing required functions');
	}
	return exports as PdqWasmExports;
}

/** Compile the sidecar once per isolate / Node process. */
function initPdq(): Promise<void> {
	modulePromise ??= (async () => {
		const bytes = readPdqWasmBytes();
		const wasm = new Uint8Array(bytes.byteLength);
		wasm.set(bytes);
		let memory: WebAssembly.Memory | undefined;
		const compiled = await WebAssembly.compile(wasm.buffer);
		const instance = await WebAssembly.instantiate(compiled, {
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
		});
		const loaded = assertPdqExports(instance.exports);
		memory = loaded[PDQ_EXPORT.memory];
		loaded[PDQ_EXPORT.init]();
		return loaded;
	})();
	return modulePromise.then(() => undefined);
}

/** Hash an RGB raster with Meta PDQ and return the 32-byte digest plus quality. */
export async function hashPdq(image: PdqHashInput): Promise<PdqHashResult> {
	await initPdq();
	const loaded = await modulePromise;
	if (!loaded) throw new Error('pdq-wasm failed to initialize');
	const expected = image.width * image.height * image.channels;
	if (image.data.length !== expected) {
		throw new Error(
			`Invalid image data size. Expected ${expected} bytes, got ${image.data.length}`
		);
	}
	const malloc = loaded[PDQ_EXPORT.malloc];
	const free = loaded[PDQ_EXPORT.free];
	const imagePtr = malloc(image.data.length);
	const hashPtr = malloc(32);
	const qualityPtr = malloc(4);
	try {
		new Uint8Array(loaded[PDQ_EXPORT.memory].buffer).set(image.data, imagePtr);
		const status = loaded[PDQ_EXPORT.hashFromRgb](
			imagePtr,
			image.width,
			image.height,
			hashPtr,
			qualityPtr
		);
		if (status !== 0) throw new Error(`PDQ hashing failed with code: ${status}`);
		const heap = new Uint8Array(loaded[PDQ_EXPORT.memory].buffer);
		return {
			hash: heap.slice(hashPtr, hashPtr + 32),
			quality: new Int32Array(loaded[PDQ_EXPORT.memory].buffer)[qualityPtr >> 2]!
		};
	} finally {
		free(imagePtr);
		free(hashPtr);
		free(qualityPtr);
	}
}

/** Encode a 32-byte PDQ digest as the 64-char hex stored on `photo_evidence`. */
export function pdqHashToHex(hash: Uint8Array): string {
	if (hash.length !== 32) {
		throw new Error(`PDQ hashes must be 32 bytes (got ${hash.length})`);
	}
	return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
