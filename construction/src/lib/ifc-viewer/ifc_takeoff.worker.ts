/// <reference lib="webworker" />
import { createIfcStepStreamParser, type ExtractedBimModel } from '../bim-step-stream.js';

declare const self: DedicatedWorkerGlobalScope;

const SLICE_BYTES = 4 * 1024 * 1024;

type TakeoffRequest =
	| { readonly type: 'extract-file'; readonly file: File }
	| { readonly type: 'extract-url'; readonly url: string };

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

function post(msg: TakeoffWorkerMessage): void {
	self.postMessage(msg);
}

async function extractFromFile(file: File): Promise<void> {
	const started = performance.now();
	const parser = createIfcStepStreamParser();
	const totalBytes = file.size;
	let offset = 0;

	while (offset < totalBytes) {
		const end = Math.min(totalBytes, offset + SLICE_BYTES);
		const buf = await file.slice(offset, end).arrayBuffer();
		parser.push(new Uint8Array(buf));
		offset = end;
		const percent = totalBytes > 0 ? Math.min(99, Math.round((offset / totalBytes) * 100)) : 99;
		post({
			type: 'progress',
			percent,
			bytesRead: offset,
			totalBytes,
			rawAssets: parser.stats().raw_assets
		});
	}

	const extracted = parser.finish();
	const stats = parser.stats();
	post({
		type: 'success',
		extracted,
		durationMs: Math.round(performance.now() - started),
		statementsScanned: stats.statements_scanned
	});
}

async function extractFromUrl(url: string): Promise<void> {
	const started = performance.now();
	const response = await fetch(url, { credentials: 'include' });
	if (!response.ok) {
		throw new Error(`Unable to fetch IFC file (HTTP ${response.status}).`);
	}
	const parser = createIfcStepStreamParser();
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
				const percent =
					totalBytes > 0 ? Math.min(99, Math.round((bytesRead / totalBytes) * 100)) : 50;
				post({
					type: 'progress',
					percent,
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

	const extracted = parser.finish();
	const stats = parser.stats();
	post({
		type: 'success',
		extracted,
		durationMs: Math.round(performance.now() - started),
		statementsScanned: stats.statements_scanned
	});
}

function isTakeoffRequest(value: unknown): value is TakeoffRequest {
	if (typeof value !== 'object' || value === null || !('type' in value)) return false;
	if (value.type === 'extract-file' && 'file' in value && value.file instanceof File) return true;
	if (value.type === 'extract-url' && 'url' in value && typeof value.url === 'string') return true;
	return false;
}

self.onmessage = (event: MessageEvent<unknown>) => {
	if (!isTakeoffRequest(event.data)) return;
	const req = event.data;
	const run = req.type === 'extract-file' ? extractFromFile(req.file) : extractFromUrl(req.url);
	void run.catch((error: unknown) => {
		post({
			type: 'error',
			error: error instanceof Error ? error.message : 'Unable to stream IFC file in browser worker.'
		});
	});
};

self.onerror = () => {
	post({ type: 'error', error: 'IFC browser streaming worker crashed.' });
};
