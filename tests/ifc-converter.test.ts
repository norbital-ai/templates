import { Schema, Effect } from 'effect';
import { afterEach, expect, it, vi } from '@effect/vitest';
import { convertIfcToFragments } from '../src/lib/ifc-viewer/ifc_viewer.converter.js';
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
it.live.each(['construct', 'post'] as const)(
	'revokes converter blob URL when %s fails',
	(failure) =>
		Effect.gen(function* () {
			const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:converter');
			const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
			const terminate = vi.fn();
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('worker script')));
			vi.stubGlobal(
				'Worker',
				class {
					constructor() {
						if (failure === 'construct') throw new Error('construct');
					}
					terminate = terminate;
					postMessage() {
						throw new Error('post');
					}
				}
			);
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(convertIfcToFragments(new Uint8Array([1]), (key) => key))
					).rejects.toThrow(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(create).toHaveBeenCalledTimes(1);
			expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:converter');
			expect(terminate).toHaveBeenCalledTimes(failure === 'construct' ? 0 : 1);
		})
);
it.live('accepts one completion when worker repeats terminal events', () =>
	Effect.gen(function* () {
		const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:converter');
		const terminate = vi.fn();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('worker script')));
		vi.stubGlobal(
			'Worker',
			class {
				onmessageerror: (() => void) | null = null;
				terminate = terminate;
				postMessage() {
					this.onmessageerror?.();
					this.onmessageerror?.();
				}
			}
		);
		yield* Effect.tryPromise({
			try: () =>
				expect(
					Effect.runPromise(convertIfcToFragments(new Uint8Array([1]), (key) => key))
				).rejects.toThrow('component.ifc_worker_communication_failed'),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
		expect(terminate).toHaveBeenCalledTimes(1);
		expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:converter');
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
