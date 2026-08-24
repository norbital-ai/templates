// Loaded by `verify-fixture-shapes.mjs`, never imported directly.

/**
 * Instrumentation half of `verify-fixture-shapes.mjs`. See that file for what the check is for.
 *
 * This module deliberately serves two roles in the main thread:
 *
 * 1. **As a synchronous module hook** `resolve()` redirects the target script's bare `vite`
 *    specifier to this same file, so the target receives our `createServer` instead of the real one.
 *    Nothing else is touched — a `vite` import from anywhere else, including this file's own,
 *    resolves normally.
 * 2. **In the main thread** the target script imports `createServer` from here. It builds a real
 *    Vite server, then wraps `ssrLoadModule` so every function the target pulls out of the payroll
 *    engine has its arguments deep-proxied before the call.
 *
 * `vite` stays a dynamic import so registering the hook cannot intercept this module's own runtime
 * dependency. Findings accumulate on `globalThis` because the target script — which we do not
 * modify — has no way to hand anything back.
 */

import { Effect } from 'effect';

/** Structures whose internals must not be proxied: doing so changes real behaviour. */
const OPAQUE = [Date, Map, Set, RegExp, WeakMap, WeakSet, Promise, Error];

/**
 * Property names that are protocol rather than data. A miss on these says nothing about the
 * fixture: they are probed by `JSON.stringify`, `await`, `console.log` and friends.
 */
const PROTOCOL_KEYS = new Set([
	'then',
	'toJSON',
	'toString',
	'valueOf',
	'constructor',
	'inspect',
	'nodeType',
	'length',
	'name',
	'@@__IMMUTABLE_ITERABLE__@@'
]);

const MAX_DEPTH = 6;
const proxyTargets = new WeakMap();

function sink() {
	globalThis.__FIXTURE_SHAPE_FINDINGS ??= new Map();
	return globalThis.__FIXTURE_SHAPE_FINDINGS;
}

function record(path) {
	const found = sink();
	found.set(path, (found.get(path) ?? 0) + 1);
}

/**
 * Wrap `value` so that reading a key it does not have is recorded against `path`.
 *
 * Only plain objects and arrays are wrapped. The proxy is otherwise transparent: it returns exactly
 * what the target would have returned, so an instrumented run should produce the same assertion
 * results as a plain one. `verify-fixture-shapes.mjs` reports the target's own pass/fail count so a
 * discrepancy against the plain run is visible rather than silent.
 */
function proxify(value, path, depth = 0) {
	if (value === null || typeof value !== 'object') return value;
	if (OPAQUE.some((type) => value instanceof type)) return value;
	if (depth >= MAX_DEPTH) return value;

	const proxy = new Proxy(value, {
		get(target, key, receiver) {
			if (
				typeof key === 'string' &&
				!Reflect.has(target, key) &&
				!PROTOCOL_KEYS.has(key) &&
				!/^\d+$/.test(key)
			) {
				record(`${path}.${key}`);
			}
			const read = Reflect.get(target, key, receiver);
			// Methods are bound to the *proxy*, not the raw target. Binding to the target was the
			// first thing tried and it silently blinded the whole detector: the engine reaches almost
			// every line through `lines.reduce(...)`, and a `reduce` bound to the raw array hands the
			// callback raw elements, so nothing below an array was ever inspected. Numeric keys and
			// `length` are exempt above, so iterating through the proxy costs no false findings.
			if (typeof read === 'function') return read.bind(receiver);
			return proxify(read, `${path}.${String(key)}`, depth + 1);
		}
	});
	proxyTargets.set(proxy, value);
	return proxy;
}

/** Restore argument objects when an engine function returns them, directly or inside a result. */
function restoreReturnedArguments(value, seen = new WeakMap()) {
	if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
	const target = proxyTargets.get(value);
	if (target !== undefined) return target;
	if (OPAQUE.some((type) => value instanceof type)) return value;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return value;
	if (seen.has(value)) return seen.get(value);

	const restoredEntries = [];
	let changed = false;
	seen.set(value, value);
	for (const [key, child] of Object.entries(value)) {
		const restored = restoreReturnedArguments(child, seen);
		restoredEntries.push([key, restored]);
		if (restored !== child) changed = true;
	}
	if (!changed) return value;

	const restored = Array.isArray(value) ? [] : {};
	seen.set(value, restored);
	for (const [key, child] of restoredEntries) restored[key] = child;
	return restored;
}

/** Role 2 — the shim the target script receives in place of Vite's own `createServer`. */
export function createServer(options) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const vite = yield* Effect.tryPromise(() => import('vite'));
			const server = yield* Effect.tryPromise(() => vite.createServer(options));
			const load = server.ssrLoadModule.bind(server);

			server.ssrLoadModule = (id, ...rest) =>
				Effect.runPromise(
					Effect.map(
						Effect.tryPromise(() => load(id, ...rest)),
						(namespace) => {
							const moduleName = id
								.split('/')
								.pop()
								.replace(/\.[cm]?ts$/, '');
							const wrapped = {};
							for (const key of Object.keys(namespace)) {
								const exported = namespace[key];
								wrapped[key] =
									typeof exported === 'function'
										? (...args) => {
												const returned = exported(
													...args.map((arg, index) =>
														proxify(arg, `${moduleName}.${key}(arg${index})`)
													)
												);
												return restoreReturnedArguments(returned);
											}
										: exported;
							}
							return wrapped;
						}
					)
				);

			return server;
		})
	);
}

// ── Role 1: module-loader hooks ─────────────────────────────────────────────────────────────────

/**
 * The synchronous resolve hook, closed over the exact target and shim URLs.
 *
 * A factory rather than a hook reading a module-level `config` that a second export had to set
 * first: the two had to be sequenced correctly by every caller, and nothing said so. Here the hook
 * cannot exist without its configuration.
 */
export function createResolve(config) {
	return (specifier, context, nextResolve) => {
		if (specifier === 'vite' && context.parentURL === config.targetUrl) {
			return { url: config.probeUrl, shortCircuit: true };
		}
		return nextResolve(specifier, context);
	};
}
