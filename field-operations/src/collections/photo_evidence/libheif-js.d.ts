/**
 * The wasm-bundle libheif build ships no declarations for the bundler entry point.
 *
 * Only the surface `photo-integrity.ts` drives is described: `ready`, `HeifDecoder.decode`,
 * `HeifImage.display`/`get_width`/`get_height`/`free`, and the decoder's Emscripten `delete()`.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
	export type HeifImage = {
		get_width(): number;
		get_height(): number;
		display(
			target: { data: Uint8ClampedArray; width: number; height: number },
			callback: (result: { data: Uint8ClampedArray } | null) => void
		): void;
		free(): void;
	};

	export type HeifDecoderInstance = {
		decode(bytes: Uint8Array): HeifImage[];
		decoder: { delete(): void };
	};

	export type HeifModule = {
		readonly ready?: Promise<void>;
		readonly HeifDecoder: new () => HeifDecoderInstance;
	};

	/**
	 * The factory returns the module directly when the embedded WASM instantiates synchronously and
	 * a promise when it does not; callers must accept both.
	 */
	const createLibheif: (options?: {
		readonly wasmBinary?: Uint8Array;
	}) => HeifModule | Promise<HeifModule>;
	export default createLibheif;
}
