/// <reference types="svelte" />
import { bolt } from '$bolt';
import type { Q } from '@norbital-ai/bolt';

/**
 * A `bolt` read kept live while the calling component renders (rule 64). `query()` may return `null` for "nothing to
 * read yet"; it re-subscribes when what it reads changes. Call during component initialisation.
 */
export function live<T>(query: () => Q<T> | null) {
	let current = $state<T | undefined>(undefined);
	let error = $state<string | undefined>(undefined);
	$effect(() => {
		const q = query();
		if (q == null) {
			current = undefined;
			return;
		}
		const view = bolt.live(q);
		return view.subscribe((value) => {
			current = value;
			error = view.error?.message;
		});
	});
	return {
		get current() {
			return current;
		},
		get error() {
			return error;
		}
	};
}
