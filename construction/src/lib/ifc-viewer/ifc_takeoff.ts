import { Effect, Result, Schema } from 'effect';
import takeoffWorkerUrl from './ifc_takeoff.worker.ts?worker&url';
import { fetchEffect, messageOf } from './ifc_viewer.types.js';
import type { ExtractedBimModel } from '../bim-step-stream.js';

export type BimStreamProgress = {
	readonly percent: number;
	readonly bytesRead: number;
	readonly totalBytes: number;
	readonly rawAssets: number;
};

export type BimStreamResult = {
	readonly extracted: ExtractedBimModel;
	readonly durationMs: number;
	readonly statementsScanned: number;
};

class BimStreamError extends Schema.TaggedError<BimStreamError>()('BimStreamError', {
	message: Schema.String
}) {}

const WorkerProgressSchema = Schema.Struct({
	type: Schema.Literal('progress'),
	percent: Schema.Number,
	bytesRead: Schema.Number,
	totalBytes: Schema.Number,
	rawAssets: Schema.Number
});

const WorkerErrorSchema = Schema.Struct({
	type: Schema.Literal('error'),
	error: Schema.String
});

const ExtractedArchetypeSchema = Schema.Struct({
	archetype_id: Schema.String,
	ifc_class: Schema.String,
	family: Schema.String,
	type_name: Schema.NullOr(Schema.String),
	object_type: Schema.NullOr(Schema.String),
	predefined_type: Schema.NullOr(Schema.String),
	classification_code: Schema.NullOr(Schema.String),
	classification_name: Schema.NullOr(Schema.String),
	materials: Schema.Array(Schema.String),
	properties: Schema.Array(Schema.String),
	sample_names: Schema.Array(Schema.String),
	total_count: Schema.Number,
	has_length: Schema.Boolean,
	has_area: Schema.Boolean,
	has_volume: Schema.Boolean,
	has_weight: Schema.Boolean
});

const ExtractedBucketSchema = Schema.Struct({
	archetype_id: Schema.String,
	storey: Schema.String,
	element_count: Schema.Number,
	length_m: Schema.Number,
	length_measured_count: Schema.Number,
	area_m2: Schema.Number,
	area_measured_count: Schema.Number,
	volume_m3: Schema.Number,
	volume_measured_count: Schema.Number,
	weight_kg: Schema.Number,
	weight_measured_count: Schema.Number,
	sample_express_ids: Schema.Array(Schema.Number)
});

const WorkerSuccessSchema = Schema.Struct({
	type: Schema.Literal('success'),
	extracted: Schema.Struct({
		schema: Schema.String,
		project_name: Schema.NullOr(Schema.String),
		storeys: Schema.Array(Schema.String),
		total_asset_count: Schema.Number,
		archetypes: Schema.Array(ExtractedArchetypeSchema),
		buckets: Schema.Array(ExtractedBucketSchema)
	}),
	durationMs: Schema.Number,
	statementsScanned: Schema.Number
});

const WorkerMessageSchema = Schema.Union([
	WorkerProgressSchema,
	WorkerSuccessSchema,
	WorkerErrorSchema
]);

const createTakeoffWorker = Effect.gen(function* () {
	const workerUrl = new URL(takeoffWorkerUrl, import.meta.url);
	const response = yield* fetchEffect(workerUrl.href, 'load-ifc-takeoff-worker').pipe(
		Effect.mapError((cause) => new BimStreamError({ message: messageOf(cause) }))
	);
	const scriptText = yield* Effect.tryPromise({
		try: () => response.text(),
		catch: (cause) => new BimStreamError({ message: messageOf(cause) })
	});
	const blob = new Blob([scriptText], { type: 'application/javascript' });
	const blobUrl = yield* Effect.acquireRelease(
		Effect.sync(() => URL.createObjectURL(blob)),
		(url) => Effect.sync(() => URL.revokeObjectURL(url))
	);
	return yield* Effect.try({
		try: () => new Worker(blobUrl, { name: 'norbital-ifc-takeoff' }),
		catch: (cause) => new BimStreamError({ message: messageOf(cause) })
	});
});

function runWorkerRequest(
	worker: Worker,
	request:
		| { readonly type: 'extract-file'; readonly file: File }
		| { readonly type: 'extract-url'; readonly url: string },
	onProgress?: (progress: BimStreamProgress) => void
): Effect.Effect<BimStreamResult, BimStreamError> {
	return Effect.callback((send) => {
		worker.onmessage = (event: MessageEvent<unknown>) => {
			const decoded = Schema.decodeUnknownOption(WorkerMessageSchema)(event.data);
			if (decoded._tag === 'None') return;
			const msg = decoded.value;
			if (msg.type === 'progress') {
				onProgress?.({
					percent: msg.percent,
					bytesRead: msg.bytesRead,
					totalBytes: msg.totalBytes,
					rawAssets: msg.rawAssets
				});
				return;
			}
			if (msg.type === 'success') {
				send(
					Effect.succeed({
						extracted: msg.extracted,
						durationMs: msg.durationMs,
						statementsScanned: msg.statementsScanned
					})
				);
				return;
			}
			send(Effect.fail(new BimStreamError({ message: msg.error })));
		};
		worker.onerror = (event: ErrorEvent) => {
			send(
				Effect.fail(
					new BimStreamError({ message: event.message || 'IFC streaming worker failed.' })
				)
			);
		};
		worker.onmessageerror = () => {
			send(Effect.fail(new BimStreamError({ message: 'IFC streaming worker message error.' })));
		};
		const posted = Result.try(() => worker.postMessage(request));
		if (Result.isFailure(posted)) {
			send(Effect.fail(new BimStreamError({ message: messageOf(posted.failure) })));
		}
		return Effect.sync(() => {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		});
	});
}

/**
 * Streams a local browser `File` (arbitrarily large 50–500+ MiB IFC models) in 4 MiB chunks
 * inside a dedicated Web Worker and returns the compact bucketed `ExtractedBimModel`.
 */
export function extractBimFromFile(
	file: File,
	onProgress?: (progress: BimStreamProgress) => void
): Effect.Effect<BimStreamResult, BimStreamError> {
	return Effect.acquireUseRelease(
		createTakeoffWorker,
		(worker) => runWorkerRequest(worker, { type: 'extract-file', file }, onProgress),
		(worker) => Effect.sync(() => worker.terminate())
	).pipe(Effect.scoped);
}

/**
 * Streams an uploaded IFC file URL (e.g., 8–20 MiB stored `project_files.file.url`) inside a
 * dedicated Web Worker and returns the compact bucketed `ExtractedBimModel`.
 */
export function extractBimFromUrl(
	url: string,
	onProgress?: (progress: BimStreamProgress) => void
): Effect.Effect<BimStreamResult, BimStreamError> {
	const resolved = new URL(url, window.location.href).href;
	return Effect.acquireUseRelease(
		createTakeoffWorker,
		(worker) => runWorkerRequest(worker, { type: 'extract-url', url: resolved }, onProgress),
		(worker) => Effect.sync(() => worker.terminate())
	).pipe(Effect.scoped);
}
