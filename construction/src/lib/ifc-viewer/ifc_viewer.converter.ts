import { Effect, Result, Schema } from 'effect';
import converterWorkerUrl from './ifc_viewer.converter.worker.ts?worker&url';
import {
	type ConvertRequestMessage,
	type Translator,
	WorkerResponseMessageSchema,
	fetchEffect,
	messageOf
} from './ifc_viewer.types.js';
/** Error codes the converter worker posts instead of display copy. */
const WORKER_ERROR_KEYS: Readonly<Record<string, Parameters<Translator>[0]>> = {
	'ifc.unable_to_convert': 'component.ifc_unable_to_convert',
	'ifc.worker_crashed': 'component.ifc_worker_crashed'
};
function resolveWorkerError(raw: string, t: Translator): string {
	const key = WORKER_ERROR_KEYS[raw];
	return key === undefined ? raw : t(key);
}
/**
 * A failure on the converter worker channel. `context` carries the crash event fields so the
 * structured log keeps the diagnostics the console.error used to print; it is null for protocol
 * failures that already name themselves in the message.
 */
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
	const workerUrl = new URL(converterWorkerUrl, import.meta.url);
	// Sandboxed iframes block direct worker URLs in Chrome.
	// Fetch the script and create a blob URL to bypass the restriction.
	const response = yield* fetchEffect(workerUrl.href, 'load-ifc-converter-worker');
	const scriptText = yield* Effect.tryPromise({
		try: () => response.text(),
		catch: (cause) => workerFailure(messageOf(cause))
	});
	const blob = new Blob([scriptText], { type: 'application/javascript' });
	const blobUrl = yield* Effect.acquireRelease(
		Effect.sync(() => URL.createObjectURL(blob)),
		(url) => Effect.sync(() => URL.revokeObjectURL(url))
	);
	return yield* Effect.try({
		try: () => new Worker(blobUrl, { name: 'norbital-ifc-converter' }),
		catch: (cause) => workerFailure(messageOf(cause))
	});
});
function runConversion(
	worker: Worker,
	transferBuffer: ArrayBuffer,
	t: Translator
): Effect.Effect<Uint8Array, WorkerConnectionError> {
	return Effect.callback((send) => {
		worker.onmessage = (event: MessageEvent<unknown>) => {
			const message = Schema.decodeUnknownOption(WorkerResponseMessageSchema)(event.data);
			if (message._tag === 'None' || message.value.type === 'ready') return;
			if (message.value.type === 'success') {
				send(Effect.succeed(new Uint8Array(message.value.fragmentBytes)));
				return;
			}
			send(Effect.fail(workerFailure(resolveWorkerError(message.value.error, t))));
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
			const errorMessage = details || t('component.ifc_unknown_worker_error');
			send(
				Effect.fail(
					workerFailure(cause instanceof Error ? cause.message : errorMessage, {
						message: event.message,
						filename: event.filename ?? null,
						lineno: event.lineno ?? null,
						colno: event.colno ?? null,
						error: cause ?? null
					})
				)
			);
		};
		worker.onmessageerror = () => {
			send(Effect.fail(workerFailure(t('component.ifc_worker_communication_failed'))));
		};
		const posted = Result.try(() =>
			worker.postMessage(
				{ type: 'convert', bytes: transferBuffer } satisfies ConvertRequestMessage,
				[transferBuffer]
			)
		);
		if (Result.isFailure(posted)) send(Effect.fail(workerFailure(messageOf(posted.failure))));
		return Effect.sync(() => {
			worker.onmessage = null;
			worker.onerror = null;
			worker.onmessageerror = null;
		});
	});
}
/**
 * Decodes IFC bytes into @thatopen fragments inside a dedicated worker, one worker per call, torn
 * down when the conversion settles. The formatted error is translated here so the caller displays
 * copy, not code.
 */
export function convertIfcToFragments(
	bytes: Uint8Array,
	t: Translator
): Effect.Effect<Uint8Array, WorkerConnectionError> {
	// Copy so the transferred buffer backs no view the caller still holds; detaching it cannot tear
	// other data.
	const transferBuffer = Uint8Array.from(bytes).buffer;
	return Effect.acquireUseRelease(
		createConverterWorker.pipe(
			Effect.catch((error) => Effect.fail(workerFailure(messageOf(error))))
		),
		(worker) => runConversion(worker, transferBuffer, t),
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
