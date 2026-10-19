import type { CollectionName, Page } from '@norbital-ai/bolt';
import type { Read } from '@norbital-ai/bolt/page';
import { bolt, live as streamLive } from '$bolt';

/** A typed page read on the mounted UI edge; its stream closes with the component. */
export function live<T>(query: () => Read<T> | null, on?: readonly CollectionName[]) {
	const view = streamLive(() => {
		const read = query();
		if (read === null) return null;
		const clock = /"(now|today|startOf)":/.test(JSON.stringify(read.read));
		return bolt.live(read, {
			...(on === undefined ? {} : { on }),
			...(clock ? { every: '60s' } : {})
		});
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

export function liveRows<R>(query: () => Read<Page<R>> | null) {
	const view = live(query);
	return {
		get current(): readonly R[] | undefined {
			return view.current?.rows;
		},
		get loading() {
			return view.loading;
		},
		get error() {
			return view.error;
		}
	};
}
