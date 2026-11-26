/// <reference lib="webworker" />
import type { BimConfig, ExtractedBimModel } from '../bim/schema.js';
import { createIfcStepStreamParser } from '../bim/step-parser.js';

declare const self: DedicatedWorkerGlobalScope;
const SLICE_BYTES = 4 * 1024 * 1024;

type TakeoffRequest =
	| { readonly type: 'extract-file'; readonly file: File; readonly config?: Partial<BimConfig> }
	| { readonly type: 'extract-url'; readonly url: string; readonly config?: Partial<BimConfig> };

type TakeoffWorkerMessage =
	| {
			readonly type: 'progress';
			readonly percent: number;
			readonly bytesRead: number;
			readonly totalBytes: number;
			readonly rawAssets: number;
	  }
	| {
			readonly type: 'success';
			readonly extracted: ExtractedBimModel;
			readonly durationMs: number;
			readonly statementsScanned: number;
	  }
	| { readonly type: 'error'; readonly error: string };

const post = (msg: TakeoffWorkerMessage) => self.postMessage(msg);

async function finishParser(
	parser: ReturnType<typeof createIfcStepStreamParser>,
	started: number
): Promise<void> {
	const extracted = parser.finish();
	const stats = parser.stats();
	post({
		type: 'success',
		extracted,
		durationMs: Math.round(performance.now() - started),
		statementsScanned: stats.statements_scanned
	});
}

async function extractFromFile(file: File, config?: Partial<BimConfig>): Promise<void> {
	const started = performance.now();
	const parser = createIfcStepStreamParser(config);
	const totalBytes = file.size;
	for (let offset = 0; offset < totalBytes;) {
		const end = Math.min(totalBytes, offset + SLICE_BYTES);
		parser.push(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
		offset = end;
		post({
			type: 'progress',
			percent: totalBytes > 0 ? Math.min(99, Math.round((offset / totalBytes) * 100)) : 99,
			bytesRead: offset,
			totalBytes,
			rawAssets: parser.stats().raw_assets
		});
	}
	await finishParser(parser, started);
}

async function extractFromUrl(url: string, config?: Partial<BimConfig>): Promise<void> {
	const started = performance.now();
	const response = await fetch(url, { credentials: 'include' });
	if (!response.ok) throw new Error(`Unable to fetch IFC file (HTTP ${response.status}).`);
	const parser = createIfcStepStreamParser(config);
	const totalBytes = Number(response.headers.get('content-length') ?? '0') || 0;
	let bytesRead = 0;

	const reader = response.body?.getReader();
	if (reader) {
		for (;;) {
			const next = await reader.read();
			if (next.done) break;
			if (next.value && next.value.byteLength > 0) {
				parser.push(next.value);
				bytesRead += next.value.byteLength;
				post({
					type: 'progress',
					percent: totalBytes > 0 ? Math.min(99, Math.round((bytesRead / totalBytes) * 100)) : 50,
					bytesRead,
					totalBytes,
					rawAssets: parser.stats().raw_assets
				});
			}
		}
	} else {
		const buf = new Uint8Array(await response.arrayBuffer());
		for (let offset = 0; offset < buf.byteLength; offset += SLICE_BYTES) {
			const slice = buf.subarray(offset, Math.min(buf.byteLength, offset + SLICE_BYTES));
			parser.push(slice);
			bytesRead += slice.byteLength;
			post({
				type: 'progress',
				percent: Math.min(99, Math.round((bytesRead / Math.max(1, buf.byteLength)) * 100)),
				bytesRead,
				totalBytes: buf.byteLength,
				rawAssets: parser.stats().raw_assets
			});
		}
	}
	await finishParser(parser, started);
}

function isTakeoffRequest(value: unknown): value is TakeoffRequest {
	if (typeof value !== 'object' || value === null || !('type' in value)) return false;
	if (value.type === 'extract-file' && 'file' in value && value.file instanceof File) return true;
	return value.type === 'extract-url' && 'url' in value && typeof value.url === 'string';
}

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isTakeoffRequest(event.data)) return;
	const req = event.data;
	const run =
		req.type === 'extract-file'
			? extractFromFile(req.file, req.config)
			: extractFromUrl(req.url, req.config);
	void run.catch((error: unknown) =>
		post({
			type: 'error',
			error: error instanceof Error ? error.message : 'Unable to stream IFC file in browser worker.'
		})
	);
};
self.onerror = () => post({ type: 'error', error: 'IFC browser streaming worker crashed.' });
