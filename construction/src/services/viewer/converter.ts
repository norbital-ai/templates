import { Effect, Result, Schema } from 'effect';
import converterWorkerUrl from './converter.worker.ts?worker&url';
import {
	type ConvertRequestMessage,
	type Translator,
	WorkerResponseMessageSchema,
	fetchEffect,
	messageOf,
	moduleWorkerSource
} from './types.js';

const WORKER_ERROR_KEYS: Readonly<Record<string, Parameters<Translator>[0]>> = {
	'ifc.unable_to_convert': 'component.ifc_unable_to_convert',
	'ifc.worker_crashed': 'component.ifc_worker_crashed'
};

const FRAGMENT_CACHE_NAME = 'norbital-ifc-fragments-v2';
const MEMORY_CACHE_LIMIT = 4;
const memoryFragmentCache = new Map<string, Uint8Array>();
let cachedWorkerScriptText: string | null = null;

const cacheUrlForKey = (cacheKey: string) =>
	`https://norbital-ifc-fragments.cache/v2/${encodeURIComponent(cacheKey)}`;

function rememberInMemory(cacheKey: string, bytes: Uint8Array): void {
	if (memoryFragmentCache.has(cacheKey)) memoryFragmentCache.delete(cacheKey);
	memoryFragmentCache.set(cacheKey, bytes);
	while (memoryFragmentCache.size > MEMORY_CACHE_LIMIT) {
		const oldest = memoryFragmentCache.keys().next().value;
		if (oldest === undefined) break;
		memoryFragmentCache.delete(oldest);
	}
}

export function readCachedFragments(cacheKey: string): Effect.Effect<Uint8Array | null, never> {
	const inMem = memoryFragmentCache.get(cacheKey);
	if (inMem !== undefined) {
		rememberInMemory(cacheKey, inMem);
		return Effect.succeed(inMem);
	}
	if (typeof globalThis.caches === 'undefined') return Effect.succeed(null);
	return Effect.tryPromise({
		try: async () => {
			const cache = await globalThis.caches.open(FRAGMENT_CACHE_NAME);
			const match = await cache.match(cacheUrlForKey(cacheKey));
			if (!match) return null;
			const bytes = new Uint8Array(await match.arrayBuffer());
			if (bytes.byteLength === 0) return null;
			rememberInMemory(cacheKey, bytes);
			return bytes;
		},
		catch: () => null
	}).pipe(Effect.catch(() => Effect.succeed(null)));
}

export function writeCachedFragments(
	cacheKey: string,
	bytes: Uint8Array
): Effect.Effect<void, never> {
	rememberInMemory(cacheKey, bytes);
	if (typeof globalThis.caches === 'undefined') return Effect.void;
	const copy = Uint8Array.from(bytes);
	return Effect.tryPromise({
		try: async () => {
			const cache = await globalThis.caches.open(FRAGMENT_CACHE_NAME);
			await cache.put(
				cacheUrlForKey(cacheKey),
				new Response(copy, {
					headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'immutable' }
				})
			);
		},
		catch: () => undefined
	}).pipe(Effect.ignore);
}

class WorkerConnectionError extends Schema.TaggedError<WorkerConnectionError>()(
	'WorkerConnectionError',
	{
		message: Schema.String,
		context: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))
	}
) {}
const workerFailure = (message: string, context: Readonly<Record<string, unknown>> | null = null) =>
	new WorkerConnectionError({ message, context });

const createConverterWorker = Effect.gen(function* () {
	let scriptText = cachedWorkerScriptText;
	if (scriptText === null) {
		const workerUrl = new URL(converterWorkerUrl, import.meta.url);
		const response = yield* fetchEffect(workerUrl.href, 'load-ifc-converter-worker');
		scriptText = moduleWorkerSource(
			yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (cause) => workerFailure(messageOf(cause))
			}),
			workerUrl
		);
		cachedWorkerScriptText = scriptText;
	}
	const blobUrl = yield* Effect.acquireRelease(
		Effect.sync(() => URL.createObjectURL(new Blob([scriptText], { type: 'text/javascript' }))),
		(url) => Effect.sync(() => URL.revokeObjectURL(url))
	);
	return yield* Effect.try({
		try: () => new Worker(blobUrl, { name: 'norbital-ifc-converter', type: 'module' }),
		catch: (cause) => workerFailure(messageOf(cause))
	});
});

function runConversion(
	worker: Worker,
	transferBuffer: ArrayBuffer,
	t: Translator,
	excludeClasses?: readonly string[]
): Effect.Effect<Uint8Array, WorkerConnectionError> {
	return Effect.callback((send) => {
		worker.onmessage = (event: MessageEvent<unknown>) => {
			const message = Schema.decodeUnknownOption(WorkerResponseMessageSchema)(event.data);
			if (message._tag === 'None' || message.value.type === 'ready') return;
			if (message.value.type === 'success') {
				send(Effect.succeed(new Uint8Array(message.value.fragmentBytes)));
				return;
			}
			const key = WORKER_ERROR_KEYS[message.value.error];
			send(Effect.fail(workerFailure(key === undefined ? message.value.error : t(key))));
		};
		worker.onerror = (event: ErrorEvent) => {
			const cause: unknown = event.error;
			const details = [
				event.message,
				event.filename ? `file: ${event.filename}` : null,
				event.lineno ? `line: ${event.lineno}` : null,
				event.colno ? `col: ${event.colno}` : null
			]
				.filter(Boolean)
				.join(', ');
			send(
				Effect.fail(
					workerFailure(
						cause instanceof Error
							? cause.message
							: details || t('component.ifc_unknown_worker_error'),
						{
							message: event.message,
							filename: event.filename ?? null,
							lineno: event.lineno ?? null,
							colno: event.colno ?? null,
							error: cause ?? null
						}
					)
				)
			);
		};
		worker.onmessageerror = () =>
			send(Effect.fail(workerFailure(t('component.ifc_worker_communication_failed'))));
		const request: ConvertRequestMessage = {
			type: 'convert',
			bytes: transferBuffer,
			...(excludeClasses && excludeClasses.length > 0
				? { excludeClasses: [...excludeClasses] }
				: {})
		};
		const posted = Result.try(() => worker.postMessage(request, [transferBuffer]));
		if (Result.isFailure(posted)) send(Effect.fail(workerFailure(messageOf(posted.failure))));
		return Effect.sync(() => {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		});
	});
}

export function convertIfcToFragments(
	bytes: Uint8Array,
	t: Translator,
	excludeClasses?: readonly string[]
): Effect.Effect<Uint8Array, WorkerConnectionError> {
	const transferBuffer = Uint8Array.from(bytes).buffer;
	return Effect.acquireUseRelease(
		createConverterWorker.pipe(
			Effect.catch((error) => Effect.fail(workerFailure(messageOf(error))))
		),
		(worker) => runConversion(worker, transferBuffer, t, excludeClasses),
		(worker) => Effect.sync(() => worker.terminate())
	).pipe(
		Effect.scoped,
		Effect.tapError((failure) =>
			failure instanceof WorkerConnectionError && failure.context
				? Effect.logError('[IFCViewer] Converter worker error event:', failure.context)
				: Effect.void
		)
	);
}
