<script lang="ts">
	/** Deletes the record a screen shows, after asking, and leaves the screen. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, confirm_action } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { saved } from './save.js';

	let {
		ctx,
		label,
		title,
		body,
		act
	}: {
		ctx: PageContext;
		label: string;
		title: string;
		body: string;
		/** The delete, as one act. */
		act: Parameters<typeof saved>[2];
	} = $props();
	let deleting = $state(false);
	function remove() {
		if (deleting) return;
		deleting = true;
		fork(
			confirm_action({ title, body, confirm_label: label, destructive: true }).pipe(
				Effect.flatMap((proceed) => (proceed ? saved(ctx, false, act) : Effect.succeed(false))),
				Effect.tap((done) => Effect.sync(() => done && history.back())),
				Effect.ensuring(Effect.sync(() => (deleting = false)))
			)
		);
	}
</script>

<Button variant="destructive" disabled={deleting} onclick={remove}>{label}</Button>
