/// <reference types="svelte" />
import { bolt, live as liveStream } from '$bolt';
import type { Read } from '@norbital-ai/bolt/page';
import type { CollectionName } from '@norbital-ai/bolt';
/** Current decoded answers for the read selected by this component. */
export function live<T>(query: () => Read<T> | null, on?: readonly CollectionName[]) {
	const view = liveStream(() => {
		const read = query();
		return read === null ? null : bolt.live(read, on === undefined ? undefined : { on });
	});
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
