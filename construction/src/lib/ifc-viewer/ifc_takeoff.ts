import { Effect, Result, Schema } from 'effect';
import takeoffWorkerUrl from './ifc_takeoff.worker.ts?worker&url';
import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { measureAndPicture, type BimGeometryProgress } from './ifc_geometry_pass.js';
import { fetchEffect, messageOf, moduleWorkerSource } from './ifc_viewer.types.js';
import { ExtractedBimModelSchema } from '../bim-pipeline.js';
import type { ExtractedBimModel } from '../bim-step-stream.js';

export type BimStreamProgress = {
	readonly phase: 'streaming';
	readonly percent: number;
	readonly bytesRead: number;
	readonly totalBytes: number;
	readonly rawAssets: number;
};

export type BimTakeoffProgress = BimStreamProgress | BimGeometryProgress;

export type BimStreamResult = {
	readonly extracted: ExtractedBimModel;
	/** Each unique asset's four-angle picture, by archetype. */
	readonly pictures: ReadonlyMap<string, Blob>;
	/** Elements dropped as modelled twice. */
	readonly duplicates: number;
	readonly durationMs: number;
	readonly statementsScanned: number;
	readonly visualCapturedCount: number;
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

const WorkerSuccessSchema = Schema.Struct({
	type: Schema.Literal('success'),
	extracted: ExtractedBimModelSchema,
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
	const source = moduleWorkerSource(scriptText, workerUrl);
	const blob = new Blob([source], { type: 'text/javascript' });
	const blobUrl = yield* Effect.acquireRelease(
		Effect.sync(() => URL.createObjectURL(blob)),
		(url) => Effect.sync(() => URL.revokeObjectURL(url))
	);
	return yield* Effect.try({
		try: () => new Worker(blobUrl, { name: 'norbital-ifc-takeoff', type: 'module' }),
		catch: (cause) => new BimStreamError({ message: messageOf(cause) })
	});
});

function runWorkerRequest(
	worker: Worker,
	request:
		| { readonly type: 'extract-file'; readonly file: File }
		| { readonly type: 'extract-url'; readonly url: string },
	onProgress?: (progress: BimTakeoffProgress) => void
): Effect.Effect<
	{
		readonly extracted: ExtractedBimModel;
		readonly durationMs: number;
		readonly statementsScanned: number;
	},
	BimStreamError
> {
	return Effect.callback((send) => {
		worker.onmessage = (event: MessageEvent<unknown>) => {
			const decoded = Schema.decodeUnknownOption(WorkerMessageSchema)(event.data);
			if (decoded._tag === 'None') return;
			const msg = decoded.value;
			if (msg.type === 'progress') {
				onProgress?.({
					phase: 'streaming',
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

function attachGeometry(
	source: File | string,
	streamed: {
		readonly extracted: ExtractedBimModel;
		readonly durationMs: number;
		readonly statementsScanned: number;
	},
	onProgress?: (progress: BimTakeoffProgress) => void
): Effect.Effect<BimStreamResult, never> {
	return Effect.gen(function* () {
		const started = performance.now();
		const { extracted, pictures, duplicates } = yield* measureAndPicture(
			source,
			streamed.extracted,
			onProgress
		);
		return {
			extracted,
			pictures,
			duplicates,
			durationMs: Math.round(streamed.durationMs + (performance.now() - started)),
			statementsScanned: streamed.statementsScanned,
			visualCapturedCount: pictures.size
		};
	});
}

/**
 * Streams a local browser `File` (arbitrarily large 50–500+ MiB IFC models) in 4 MiB chunks inside a dedicated Web
 * Worker into unique asset archetypes, then measures, merges and pictures them (`measureAndPicture`).
 */
function extractBimFromFile(
	file: File,
	onProgress?: (progress: BimTakeoffProgress) => void
): Effect.Effect<BimStreamResult, BimStreamError> {
	return Effect.acquireUseRelease(
		createTakeoffWorker,
		(worker) => runWorkerRequest(worker, { type: 'extract-file', file }, onProgress),
		(worker) => Effect.sync(() => worker.terminate())
	).pipe(
		Effect.scoped,
		Effect.flatMap((streamed) => attachGeometry(file, streamed, onProgress))
	);
}

/** As `extractBimFromFile`, for the project's stored IFC file by its URL. */
function extractBimFromUrl(
	url: string,
	onProgress?: (progress: BimTakeoffProgress) => void
): Effect.Effect<BimStreamResult, BimStreamError> {
	const resolved = new URL(url, window.location.href).href;
	return Effect.acquireUseRelease(
		createTakeoffWorker,
		(worker) => runWorkerRequest(worker, { type: 'extract-url', url: resolved }, onProgress),
		(worker) => Effect.sync(() => worker.terminate())
	).pipe(
		Effect.scoped,
		Effect.flatMap((streamed) => attachGeometry(resolved, streamed, onProgress))
	);
}

/** The takeoff's progress in the viewer's words. */
export const takeoffProgressText = (t: PageContext['t'], progress: BimTakeoffProgress): string =>
	progress.phase === 'streaming'
		? t('bim_costing.streaming_progress', { percent: progress.percent, assets: progress.rawAssets })
		: progress.phase === 'measuring'
			? t('bim_costing.measuring_progress', { done: progress.done, total: progress.total })
			: t('bim_costing.snapshots_progress', {
					done: progress.done,
					total: progress.total,
					captured: progress.captured
				});

/**
 * Takes off the project's BIM file in this browser and stores the takeoff on the project (`bim_takeoff`); storing it
 * starts the pricing automation (`analyze_bim_file`). `source` is the file just uploaded, else the stored file's URL.
 */
export const storeProjectTakeoff = (
	ctx: Pick<PageContext, 'upload' | 'query' | 'act'>,
	project: Id<'projects'>,
	source: File | string,
	onProgress?: (progress: BimTakeoffProgress) => void
) =>
	Effect.gen(function* () {
		const taken = yield* typeof source === 'string'
			? extractBimFromUrl(source, onProgress)
			: extractBimFromFile(source, onProgress);
		const views = yield* Effect.forEach(
			[...taken.pictures],
			([archetype, picture]) =>
				ctx
					.upload(
						Object.assign(picture, { name: `${archetype}.jpg` }),
						'projects.bim_takeoff_views'
					)
					.pipe(Effect.map((ref) => [archetype, ref] as const)),
			{ concurrency: 4 }
		);
		const fileOf = new Map(views.map(([archetype, ref]) => [archetype, ref.id] as const));
		const extracted = {
			...taken.extracted,
			archetypes: taken.extracted.archetypes.map((a) => {
				const visual_file = fileOf.get(a.archetype_id);
				return visual_file === undefined ? a : { ...a, visual_file };
			})
		};
		const ref = yield* ctx.upload(
			Object.assign(new Blob([JSON.stringify(extracted)], { type: 'application/json' }), {
				name: 'bim-takeoff.json'
			}),
			'projects.bim_takeoff'
		);
		const row = (yield* ctx.query({
			projects: { where: { id: { eq: project } }, fields: ['revision'], limit: 1 }
		})).projects.rows[0];
		if (row === undefined) return taken;
		yield* ctx.act({
			'projects.update': [
				{
					target: { id: row.id, revision: row.revision },
					set: { bim_takeoff: ref, bim_takeoff_views: views.map(([, view]) => view) }
				}
			]
		});
		return taken;
	});
