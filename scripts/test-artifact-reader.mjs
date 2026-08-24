import { readFileSync } from 'node:fs';

const assets = new Map([
	[
		'node_modules/pdq-wasm/wasm/pdq.wasm',
		readFileSync(new URL('../node_modules/pdq-wasm/wasm/pdq.wasm', import.meta.url))
	]
]);

globalThis.__artifactReadBytes = {
	applySync(_receiver, [path]) {
		const bytes = assets.get(path);
		return bytes == null ? null : Uint8Array.from(bytes);
	}
};
