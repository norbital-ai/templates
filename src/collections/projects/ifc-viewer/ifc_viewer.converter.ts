import { Effect, Schema } from 'effect';
import { toError } from '@norbital-ai/std';
import { httpRequest } from '@norbital-ai/std/http';
import converterWorkerUrl from './ifc_viewer.converter.worker.ts?worker&url';
import type { I18nApi } from '@norbital-ai/ui/i18n';
import type { TenantI18nKeys } from '$bolt/i18n-keys';
import type { ConvertRequestMessage } from './ifc_viewer.types.js';
import { WorkerResponseMessageSchema } from './ifc_viewer.types.js';

type Translator = I18nApi<TenantI18nKeys>['t'];

/** Error codes the converter worker posts instead of display copy. */
const WORKER_ERROR_KEYS: Readonly<Record<string, TenantI18nKeys>> = {
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
class WorkerConnectionError extends Error {
	readonly context: Readonly<Record<string, unknown>> | null;

	constructor(message: string, context: Readonly<Record<string, unknown>> | null = null) {
		super(message);
		this.name = 'WorkerConnectionError';
		this.context = context;
	}
}

const createConverterWorker = Effect.gen(function* () {
	const workerUrl = new URL(converterWorkerUrl, import.meta.url);
	// Sandboxed iframes block direct worker URLs in Chrome.
	// Fetch the script and create a blob URL to bypass the restriction.
	const response = yield* httpRequest(workerUrl.href, { operation: 'load-ifc-converter-worker' });
	const scriptText = yield* Effect.tryPromise(() => response.text());
	const blob = new Blob([scriptText], { type: 'application/javascript' });
	const blobUrl = URL.createObjectURL(blob);
	return new Worker(blobUrl, { name: 'norbital-ifc-converter' });
});

function runConversion(
	worker: Worker,
	transferBuffer: ArrayBuffer,
	t: Translator
): Effect.Effect<Uint8Array, WorkerConnectionError> {
	return Effect.callback((send) => {
		let settled = false;
		const settle = (result: Effect.Effect<Uint8Array, WorkerConnectionError>): void => {
			if (settled) return;
			settled = true;
			send(result);
		};

		worker.onmessage = (event: MessageEvent<unknown>) => {
			const message = Schema.decodeUnknownOption(WorkerResponseMessageSchema)(event.data);
			if (message._tag === 'None' || message.value.type === 'ready') return;

			if (message.value.type === 'success') {
				settle(Effect.succeed(new Uint8Array(message.value.fragmentBytes)));
				return;
			}
			settle(Effect.fail(new WorkerConnectionError(resolveWorkerError(message.value.error, t))));
		};

		worker.onerror = (event: ErrorEvent) => {
			const details = [
				event.message,
				event.filename ? `file: ${event.filename}` : null,
				event.lineno ? `line: ${event.lineno}` : null,
				event.colno ? `col: ${event.colno}` : null
			]
				.filter(Boolean)
				.join(', ');

			const errorMessage = details || t('component.ifc_unknown_worker_error');
			settle(
				Effect.fail(
					new WorkerConnectionError(
						event.error instanceof Error ? event.error.message : errorMessage,
						{
							message: event.message,
							filename: event.filename ?? null,
							lineno: event.lineno ?? null,
							colno: event.colno ?? null,
							error: event.error ?? null
						}
					)
				)
			);
		};

		worker.onmessageerror = () => {
			settle(
				Effect.fail(new WorkerConnectionError(t('component.ifc_worker_communication_failed')))
			);
		};

		Effect.runSync(
			Effect.try(() =>
				worker.postMessage(
					{
						type: 'convert',
						bytes: transferBuffer
					} satisfies ConvertRequestMessage,
					[transferBuffer]
				)
			).pipe(
				Effect.catch((error) =>
					Effect.sync(() => {
						settle(Effect.fail(new WorkerConnectionError(toError(error).message)));
					})
				)
			)
		);
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
): Effect.Effect<Uint8Array, Error> {
	// Copy so the transferred buffer backs no view the caller still holds; detaching it cannot tear
	// other data.
	const transferBuffer = Uint8Array.from(bytes).buffer;

	return Effect.acquireUseRelease(
		createConverterWorker.pipe(Effect.catch((error) => Effect.fail(toError(error)))),
		(worker) => runConversion(worker, transferBuffer, t),
		(worker) => Effect.sync(() => worker.terminate())
	).pipe(
		Effect.tapError((failure) =>
			failure instanceof WorkerConnectionError && failure.context
				? Effect.logError('[IFCViewer] Converter worker error event:', failure.context)
				: Effect.void
		)
	);
}
