/// <reference types="svelte" />
import { bolt, live as liveStream } from '$bolt';
import type { Read } from '@norbital-ai/bolt/page';
import type { CollectionName } from '@norbital-ai/bolt';
/** Seed the first live read from its server answer; a different read starts empty. */
export function live<T>(
	query: () => Read<T> | null,
	on?: readonly CollectionName[],
	initial?: NoInfer<T>
) {
	const view = liveStream(
		() => {
			const read = query();
			return read === null ? null : bolt.live(read, on === undefined ? undefined : { on });
		},
		initial === undefined ? {} : { initial }
	);
	return {
		get current() {
			return view.current;
		},
		get loading() {
			return view.loading;
		},
		get error() {
			return view.error?.message;
		}
	};
}
