/// <reference lib="webworker" />

import { Effect, Schema } from 'effect';

import {
	ConvertRequestMessageSchema,
	messageOf,
	type WorkerReadyMessage,
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
import * as Predicate from 'effect/Predicate';

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
	return Predicate.isString(firstArg) && firstArg.includes(GEOMETRY_LOG_MESSAGE);
}

/**
 * Bracket the importer run in a patched console: web-ifc logs "Zero length geometry" as a warning
 * for every empty face group, which would drown the conversion logs the operator sees.
 */
function withSuppressedGeometryLogs<T, E>(task: Effect.Effect<T, E>): Effect.Effect<T, E> {
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
	// esm.sh's `process` polyfill reports `versions.node`, so web-ifc's emscripten guard takes the worker for Node and
	// throws "not compiled for this environment"; the polyfill is one module instance per URL, shared with web-ifc.
	// ponytail: a CDN-side workaround; self-host web-ifc and fragments if esm.sh changes the polyfill again
	const { default: processShim } = yield* Effect.tryPromise(
		() => import(/* @vite-ignore */ 'https://esm.sh/node/process.mjs')
	);
	yield* Effect.sync(() =>
		Object.defineProperty(processShim, 'versions', { value: {}, configurable: true })
	);
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
					error: error instanceof Error ? messageOf(error) : 'ifc.unable_to_convert'
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
