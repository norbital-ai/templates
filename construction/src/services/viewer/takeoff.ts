import type { Id } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import { Effect, Result, Schema } from 'effect';
import { resolveBimConfig } from '../bim/config.js';
import {
	ExtractedBimModelSchema,
	type BimCleanupReport,
	type BimConfig,
	type ExtractedBimModel
} from '../bim/schema.js';
import { measureAndPicture, type BimGeometryProgress } from './geometry-pass.js';
import takeoffWorkerUrl from './takeoff.worker.ts?worker&url';
import { fetchEffect, messageOf, moduleWorkerSource } from './types.js';

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
	readonly pictures: ReadonlyMap<string, Blob>;
	readonly duplicates: number;
	readonly cleanup?: BimCleanupReport;
	readonly durationMs: number;
	readonly statementsScanned: number;
	readonly visualCapturedCount: number;
};

class BimStreamError extends Schema.TaggedError<BimStreamError>()('BimStreamError', {
	message: Schema.String
}) {}

const WorkerMessageSchema = Schema.Union([
	Schema.Struct({
		type: Schema.Literal('progress'),
		percent: Schema.Number,
		bytesRead: Schema.Number,
		totalBytes: Schema.Number,
		rawAssets: Schema.Number
	}),
	Schema.Struct({
		type: Schema.Literal('success'),
		extracted: ExtractedBimModelSchema,
		durationMs: Schema.Number,
		statementsScanned: Schema.Number
	}),
	Schema.Struct({ type: Schema.Literal('error'), error: Schema.String })
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
	const blobUrl = yield* Effect.acquireRelease(
		Effect.sync(() =>
			URL.createObjectURL(
				new Blob([moduleWorkerSource(scriptText, workerUrl)], { type: 'text/javascript' })
			)
		),
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
		| { readonly type: 'extract-file'; readonly file: File; readonly config: BimConfig }
		| { readonly type: 'extract-url'; readonly url: string; readonly config: BimConfig },
	onProgress?: (progress: BimTakeoffProgress) => void
) {
	return Effect.callback<
		{
			readonly extracted: ExtractedBimModel;
			readonly durationMs: number;
			readonly statementsScanned: number;
		},
		BimStreamError
	>((send) => {
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
			} else if (msg.type === 'success') {
				send(
					Effect.succeed({
						extracted: msg.extracted,
						durationMs: msg.durationMs,
						statementsScanned: msg.statementsScanned
					})
				);
			} else {
				send(Effect.fail(new BimStreamError({ message: msg.error })));
			}
		};
		worker.onerror = (event: ErrorEvent) =>
			send(
				Effect.fail(
					new BimStreamError({ message: event.message || 'IFC streaming worker failed.' })
				)
			);
		worker.onmessageerror = () =>
			send(Effect.fail(new BimStreamError({ message: 'IFC streaming worker message error.' })));
		const posted = Result.try(() => worker.postMessage(request));
		if (Result.isFailure(posted))
			send(Effect.fail(new BimStreamError({ message: messageOf(posted.failure) })));
		return Effect.sync(() => {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		});
	});
}

function loadWorkspaceBimConfig(ctx: Pick<PageContext, 'query'>): Effect.Effect<BimConfig, never> {
	return ctx
		.query({
			bim_settings: {
				fields: [
					'code',
					'min_confidence',
					'duplicate_center_tol_m',
					'shape_tolerance_pct',
					'size_band_step_mm',
					'connection_gap_tol_m',
					'variance_flag_pct',
					'auto_reclassify_generic',
					'auto_split_multi_storey',
					'auto_deduplicate',
					'exclude_ifc_classes',
					'size_bands_mm',
					'material_densities',
					'service_aliases',
					'extra_property_keys',
					'max_visual_archetypes',
					'max_proposals',
					'max_candidates'
				],
				limit: 10
			}
		})
		.pipe(
			Effect.map((res) =>
				resolveBimConfig(
					res.bim_settings.rows.find((r) => r.code === 'default') ?? res.bim_settings.rows[0]
				)
			),
			Effect.catch(() => Effect.succeed(resolveBimConfig()))
		);
}

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

export const storeProjectTakeoff = (
	ctx: Pick<PageContext, 'upload' | 'query' | 'act'>,
	project: Id<'projects'>,
	source: File | string,
	onProgress?: (progress: BimTakeoffProgress) => void
) =>
	Effect.gen(function* () {
		const config = yield* loadWorkspaceBimConfig(ctx);
		const resolveKnownSignatures = (
			signatures: readonly string[]
		): Effect.Effect<ReadonlySet<string>, never> =>
			signatures.length === 0
				? Effect.succeed(new Set<string>())
				: ctx
						.query({
							asset_mappings: {
								where: { signature: { in: [...signatures] }, picture: { is_null: false } },
								fields: ['signature'],
								limit: signatures.length
							}
						})
						.pipe(
							Effect.map((res) => new Set(res.asset_mappings.rows.map((r) => r.signature))),
							Effect.catch(() => Effect.succeed(new Set<string>()))
						);

		const resolvedSource: File | string =
			typeof source === 'string' ? new URL(source, window.location.href).href : source;
		const req =
			typeof resolvedSource === 'string'
				? ({ type: 'extract-url' as const, url: resolvedSource, config } as const)
				: ({ type: 'extract-file' as const, file: resolvedSource, config } as const);

		const streamed = yield* Effect.acquireUseRelease(
			createTakeoffWorker,
			(worker) => runWorkerRequest(worker, req, onProgress),
			(worker) => Effect.sync(() => worker.terminate())
		).pipe(Effect.scoped);

		const started = performance.now();
		const measured = yield* measureAndPicture(resolvedSource, streamed.extracted, {
			config,
			resolveKnownSignatures,
			...(onProgress ? { onProgress } : {})
		});
		const taken: BimStreamResult = {
			extracted: measured.extracted,
			pictures: measured.pictures,
			duplicates: measured.duplicates,
			...(measured.cleanup ? { cleanup: measured.cleanup } : {}),
			durationMs: Math.round(streamed.durationMs + (performance.now() - started)),
			statementsScanned: streamed.statementsScanned,
			visualCapturedCount: measured.pictures.size
		};

		const views = yield* Effect.forEach(
			[...taken.pictures],
			([archetype, picture]) =>
				ctx
					.upload(
						Object.assign(picture, { name: `${archetype}.jpg` }),
						'projects.bim_takeoff_views'
					)
					.pipe(Effect.map((ref) => [archetype, ref] as const)),
			{ concurrency: 6 }
		);
		const fileOf = new Map(views.map(([archetype, ref]) => [archetype, ref.id] as const));
		const overview_views = measured.overviews.flatMap((ov) => {
			const visual_file = fileOf.get(ov.key);
			return visual_file === undefined
				? []
				: [
						{
							label: ov.label,
							kind: ov.kind,
							...(ov.storey ? { storey: ov.storey } : {}),
							visual_file
						}
					];
		});
		const extracted = {
			...taken.extracted,
			...(overview_views.length > 0 ? { overview_views } : {}),
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
