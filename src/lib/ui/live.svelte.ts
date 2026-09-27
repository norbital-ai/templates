import type { CollectionName, Page, Q } from '@norbital-ai/bolt';
import { bolt } from '$bolt';
import { plain, type Wire } from '../wire.js';

/**
 * A `bolt` read kept live while the component that calls this renders (rule 64): the subscription follows `query()`,
 * which may return `null` for "nothing to read yet". Values arrive plain (`lib/wire.ts`). Must be called during
 * component initialisation.
 */
export function live<T>(query: () => Q<T> | null, on?: readonly CollectionName[]) {
	let current = $state<Wire<T> | undefined>(undefined);
	let loading = $state(true);
	let error = $state<string | undefined>(undefined);
	$effect(() => {
		const q = query();
		if (q == null) {
			current = undefined;
			loading = false;
			return;
		}
		loading = true;
		// a collection query re-runs when a collection it reads changes (`on`); a read of the clock re-reads each minute
		// (rule 64: such a view states `every`)
		const clock = /"(now|today|startOf)":/.test(JSON.stringify(q.read));
		const view = bolt.live(q, {
			...(on == null ? {} : { on }),
			...(clock ? { every: '60s' } : {})
		});
		return view.subscribe((value) => {
			current = value === undefined ? undefined : plain(value);
			error = view.error?.message;
			loading = value === undefined && view.error === undefined;
		});
	});
	return {
		get current() {
			return current;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		}
	};
}

/** Every row of a live read's page: `live(() => bolt.read(c, { …, all: true }))` as a list. */
export function liveRows<R>(query: () => Q<Page<R>> | null) {
	const view = live(query);
	return {
		get current(): readonly Wire<R>[] | undefined {
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
