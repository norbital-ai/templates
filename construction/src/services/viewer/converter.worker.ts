/// <reference lib="webworker" />
import { Effect, Schema } from 'effect';
import * as Predicate from 'effect/Predicate';
import {
	ConvertRequestMessageSchema,
	messageOf,
	type ConvertRequestMessage,
	type ViewerIfcApi,
	type ViewerIfcApiConstructor,
	type ViewerIfcImporter,
	type ViewerLocateFileHandler,
	type WorkerErrorMessage,
	type WorkerReadyMessage,
	type WorkerSuccessMessage
} from './types.js';

declare const self: DedicatedWorkerGlobalScope;
const GEOMETRY_LOG_MESSAGE = 'Fragments: Zero length geometry:';
const WEB_IFC_WASM_URL = 'https://esm.sh/web-ifc@0.0.77/web-ifc.wasm';
const DEFAULT_EXCLUDE_CLASSES = ['IFCSPACE', 'IFCOPENINGELEMENT'] as const;
const FALLBACK_IFC_CODES: Readonly<Record<string, number>> = {
	IFCSPACE: 3856911033,
	IFCOPENINGELEMENT: 3588315303
};

function configureWebIfc(wasmUrl: string, IfcAPI: ViewerIfcApiConstructor): void {
	const originalInit = IfcAPI.prototype.Init;
	IfcAPI.prototype.Init = function initWithResolvedWasmUrl(
		this: ViewerIfcApi,
		customLocateFileHandler?: ViewerLocateFileHandler,
		forceSingleThread = true
	) {
		return originalInit.call(this, customLocateFileHandler ?? (() => wasmUrl), forceSingleThread);
	};
}

const isGeometryNoise = (args: unknown[]) =>
	Predicate.isString(args[0]) && args[0].includes(GEOMETRY_LOG_MESSAGE);

function withSuppressedGeometryLogs<T, E>(task: Effect.Effect<T, E>): Effect.Effect<T, E> {
	return Effect.acquireUseRelease(
		Effect.sync(() => {
			const originalLog = console.log;
			const originalWarn = console.warn;
			console.log = (...args: unknown[]) => {
				if (!isGeometryNoise(args)) originalLog(...args);
			};
			console.warn = (...args: unknown[]) => {
				if (!isGeometryNoise(args)) originalWarn(...args);
			};
			return { originalLog, originalWarn };
		}),
		() => task,
		({ originalLog, originalWarn }) =>
			Effect.sync(() => {
				console.log = originalLog;
				console.warn = originalWarn;
			})
	);
}

function createImporter(excludeClasses: readonly string[]) {
	return Effect.gen(function* () {
		const { default: processShim } = yield* Effect.tryPromise(
			() => import(/* @vite-ignore */ 'https://esm.sh/node/process.mjs')
		);
		yield* Effect.sync(() =>
			Object.defineProperty(processShim, 'versions', { value: {}, configurable: true })
		);
		const [webIfc, FRAGS] = yield* Effect.all(
			[
				Effect.tryPromise(() => import(/* @vite-ignore */ 'https://esm.sh/web-ifc@0.0.77')),
				Effect.tryPromise(
					() =>
						import(
							/* @vite-ignore */ 'https://esm.sh/@thatopen/fragments@3.4.6?deps=three@0.185.1,web-ifc@0.0.77'
						)
				)
			],
			{ concurrency: 'unbounded' }
		);
		yield* Effect.sync(() => configureWebIfc(WEB_IFC_WASM_URL, webIfc.IfcAPI));
		const importer: ViewerIfcImporter = new FRAGS.IfcImporter();
		importer.wasm = { path: '', absolute: true };
		const elementSet = importer.classes?.elements;
		if (elementSet) {
			const webIfcRecord: Readonly<Record<string, unknown>> = webIfc;
			for (const rawName of excludeClasses) {
				const key = rawName.trim().toUpperCase();
				if (!key) continue;
				const exported = webIfcRecord[key];
				const code = typeof exported === 'number' ? exported : FALLBACK_IFC_CODES[key];
				if (code !== undefined) elementSet.delete(code);
			}
		}
		yield* Effect.try(() => self.postMessage({ type: 'ready' } satisfies WorkerReadyMessage));
		return importer;
	});
}

function handleConvert(message: ConvertRequestMessage): Effect.Effect<void, never> {
	return Effect.gen(function* () {
		const excludeClasses =
			message.excludeClasses && message.excludeClasses.length > 0
				? message.excludeClasses
				: DEFAULT_EXCLUDE_CLASSES;
		const importer = yield* createImporter(excludeClasses);
		const fragmentBytes = yield* withSuppressedGeometryLogs(
			Effect.tryPromise(() => importer.process({ bytes: new Uint8Array(message.bytes) }))
		);
		const transferable = fragmentBytes.slice().buffer;
		yield* Effect.try(() =>
			self.postMessage(
				{ type: 'success', fragmentBytes: transferable } satisfies WorkerSuccessMessage,
				[transferable]
			)
		);
	}).pipe(
		Effect.catch((error) =>
			Effect.try(() =>
				self.postMessage({
					type: 'error',
					error: error instanceof Error ? messageOf(error) : 'ifc.unable_to_convert'
				} satisfies WorkerErrorMessage)
			).pipe(Effect.ignore)
		)
	);
}

self.onmessage = (event: MessageEvent<unknown>) => {
	const message = Schema.decodeUnknownOption(ConvertRequestMessageSchema)(event.data);
	if (message._tag === 'Some') void Effect.runPromise(handleConvert(message.value));
};
self.onerror = () => {
	self.postMessage({ type: 'error', error: 'ifc.worker_crashed' } satisfies WorkerErrorMessage);
};
