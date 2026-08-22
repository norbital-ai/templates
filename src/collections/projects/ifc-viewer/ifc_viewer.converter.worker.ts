/// <reference lib="webworker" />

import { Effect, Schema } from 'effect';
import { getErrorMessage } from '@norbital-ai/std';

import {
	ConvertRequestMessageSchema,
	WorkerReadyMessage,
	type ConvertRequestMessage,
	type WorkerErrorMessage,
	type WorkerSuccessMessage
} from './ifc_viewer.types.js';
import type {
	ViewerIfcApi,
	ViewerIfcApiConstructor,
	ViewerIfcImporter,
	ViewerLocateFileHandler
} from './ifc_viewer.types.js';

declare const self: DedicatedWorkerGlobalScope;

const GEOMETRY_LOG_MESSAGE = 'Fragments: Zero length geometry:';

const WEB_IFC_WASM_URL = 'https://esm.sh/web-ifc@0.0.77/web-ifc.wasm';

/**
 * Patches `IfcAPI.prototype.Init` to serve the wasm from the pinned esm.sh CDN without letting the
 * guest library locate it itself. A converter worker handles one conversion and is then terminated,
 * so its module graph owns exactly one patch and needs no ambient configuration state.
 */
function configureWebIfc(wasmUrl: string, IfcAPI: ViewerIfcApiConstructor): void {
	const originalInit = IfcAPI.prototype.Init;
	IfcAPI.prototype.Init = function initWithResolvedWasmUrl(
		this: ViewerIfcApi,
		customLocateFileHandler?: ViewerLocateFileHandler,
		forceSingleThread = true
	) {
		const handler = customLocateFileHandler ?? (() => wasmUrl);
		return originalInit.call(this, handler, forceSingleThread);
	};
}

function shouldSuppressGeometryLog(args: unknown[]): boolean {
	const [firstArg] = args;
	return typeof firstArg === 'string' && firstArg.includes(GEOMETRY_LOG_MESSAGE);
}

/**
 * Bracket the importer run in a patched console: web-ifc logs "Zero length geometry" as a warning
 * for every empty face group, which would drown the conversion logs the operator sees.
 */
function withSuppressedGeometryLogs<T>(task: Effect.Effect<T, unknown>): Effect.Effect<T, unknown> {
	return Effect.acquireUseRelease(
		Effect.sync(() => {
			const originalLog = console.log;
			const originalWarn = console.warn;
			console.log = (...args: unknown[]) => {
				if (shouldSuppressGeometryLog(args)) return;
				originalLog(...args);
			};
			console.warn = (...args: unknown[]) => {
				if (shouldSuppressGeometryLog(args)) return;
				originalWarn(...args);
			};
			return { originalLog, originalWarn };
		}),
		() => task,
		(restored) =>
			Effect.sync(() => {
				console.log = restored.originalLog;
				console.warn = restored.originalWarn;
			})
	);
}

const importIfcImporter = Effect.gen(function* () {
	const { IfcAPI } = yield* Effect.tryPromise(
		() => import(/* @vite-ignore */ 'https://esm.sh/web-ifc@0.0.77')
	);
	yield* Effect.sync(() => configureWebIfc(WEB_IFC_WASM_URL, IfcAPI));
	const FRAGS = yield* Effect.tryPromise(
		() =>
			import(
				/* @vite-ignore */ 'https://esm.sh/@thatopen/fragments@3.4.6?deps=three@0.185.1,web-ifc@0.0.77'
			)
	);
	const instance: ViewerIfcImporter = new FRAGS.IfcImporter();
	instance.wasm = { path: '', absolute: true };
	return instance;
});

const createImporter = Effect.gen(function* () {
	const importer = yield* importIfcImporter;
	yield* Effect.try(() => self.postMessage({ type: 'ready' } satisfies WorkerReadyMessage));
	return importer;
});

function handleConvert(message: ConvertRequestMessage): Effect.Effect<void, never> {
	return Effect.gen(function* () {
		const importer = yield* createImporter;
		const fragmentBytes = yield* withSuppressedGeometryLogs(
			Effect.tryPromise(() =>
				importer.process({
					bytes: new Uint8Array(message.bytes)
				})
			)
		);
		const transferableFragmentBytes = fragmentBytes.slice().buffer;

		yield* Effect.try(() =>
			self.postMessage(
				{
					type: 'success',
					fragmentBytes: transferableFragmentBytes
				} satisfies WorkerSuccessMessage,
				[transferableFragmentBytes]
			)
		);
	}).pipe(
		Effect.catch((error) =>
			Effect.try(() =>
				self.postMessage({
					type: 'error',
					error: error instanceof Error ? getErrorMessage(error) : 'ifc.unable_to_convert'
				} satisfies WorkerErrorMessage)
			)
		)
	);
}

self.onmessage = (event: MessageEvent<unknown>) => {
	const message = Schema.decodeUnknownOption(ConvertRequestMessageSchema)(event.data);
	if (message._tag === 'None') return;

	void Effect.runPromise(handleConvert(message.value));
};

self.onerror = (event: ErrorEvent) => {
	self.postMessage({
		type: 'error',
		error: 'ifc.worker_crashed'
	} satisfies WorkerErrorMessage);
};
