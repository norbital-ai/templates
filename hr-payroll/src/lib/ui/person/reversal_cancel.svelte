<!--
@component
The ordinary delete of a reversal no run has paid yet: the reversal is cancelled, its ledger movement undone and the
original stands, reversible again. Its record sheet closes after.
-->
<script lang="ts">
	import { bolt } from '$bolt';
	import { Button, confirmAction, notifyOutcome, toast } from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import { idOf } from '../../payroll_engine/reads.js';
	let {
		of,
		id
	}: { of: 'leave_catalog_entry' | 'claim_catalog_entry' | 'adhoc_catalog_entry'; id: string } =
		$props();
	let busy = $state(false);
	// closes this record's sheet as the shell does: the `?record=` stack cut below it
	const close = () => {
		const url = new URL(location.href);
		const stack = url.searchParams.getAll('record');
		const at = stack.indexOf(`${of}/${id}`);
		if (at < 0) return;
		url.searchParams.delete('record');
		for (const record of stack.slice(0, at)) url.searchParams.append('record', record);
		history.pushState(history.state, '', url);
		dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
	};
	const remove = () =>
		of === 'leave_catalog_entry'
			? bolt.act('leave_catalog_entry.delete', [{ target: idOf(of, id) }])
			: of === 'claim_catalog_entry'
				? bolt.act('claim_catalog_entry.delete', [{ target: idOf(of, id) }])
				: bolt.act('adhoc_catalog_entry.delete', [{ target: idOf(of, id) }]);
	const cancel = () => {
		busy = true;
		fork(
			Effect.gen(function* () {
				const proceed = yield* confirmAction({
					title: 'Delete this reversal?',
					body: 'No payroll run has paid it yet. Its ledger movement is undone and the original entry stands.',
					confirmLabel: 'Delete',
					destructive: true
				});
				if (!proceed) return;
				notifyOutcome(bolt, yield* remove());
				close();
			}).pipe(
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (busy = false)))
			)
		);
	};
</script>

<Button variant="destructive" disabled={busy} onclick={cancel}>Delete</Button>
