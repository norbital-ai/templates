import { Schema, Effect } from 'effect';
// @vitest-environment happy-dom
import { expect, it } from '@effect/vitest';
import { flushSync, mount, unmount } from 'svelte';
import Schedule from './slot-picker-zone-harness.svelte';
it.live('shows the workspace time and day part when the browser uses another zone', () =>
	Effect.gen(function* () {
		const target = document.createElement('div');
		document.body.append(target);
		const app = mount(Schedule, { target });
		try {
			flushSync();
			expect(target.textContent).toContain('12:00 pm');
			expect(target.textContent).toContain('3:00 pm');
			expect(target.textContent).toContain('app.portal.afternoon');
			expect(target.textContent).not.toContain('app.portal.morning');
		} finally {
			yield* Effect.tryPromise({
				try: () => unmount(app),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			target.remove();
		}
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
