<script lang="ts">
	/** One dated change to a law: its date and what it changes. Here it is edited, moved to another date or deleted. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		confirm_action,
		notify_outcome,
		RecordShell,
		toast,
		type RecordView
	} from '@norbital-ai/ui';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';

	let { view, ctx }: { view: RecordView<'jurisdiction_change'>; ctx: PageContext } = $props();
	const record = $derived(view.mode === 'create' ? null : view.record);
	let deleting = $state(false);
	function remove() {
		if (record === null || deleting) return;
		const target = { id: record.id, revision: record.revision };
		deleting = true;
		fork(
			Effect.gen(function* () {
				const proceed = yield* confirm_action({
					title: ctx.t('law_changes.delete_title'),
					body: ctx.t('law_changes.delete_body'),
					confirm_label: ctx.t('law_changes.delete'),
					destructive: true
				});
				if (!proceed) return;
				const outcome = yield* ctx.act({ 'jurisdiction_change.delete': [{ target }] });
				notify_outcome(ctx, outcome);
				if (outcome.kind === 'committed') history.back();
			}).pipe(
				Effect.catch((error) =>
					Effect.sync(() =>
						toast.error(error instanceof Error ? error.message : ctx.t('component.error'))
					)
				),
				Effect.ensuring(Effect.sync(() => (deleting = false)))
			)
		);
	}
</script>

{#snippet actions()}{#if record !== null}<Button
			variant="destructive"
			disabled={deleting}
			onclick={remove}>{ctx.t('law_changes.delete')}</Button
		>{/if}{/snippet}

<RecordShell
	{ctx}
	of="jurisdiction_change"
	mode={view.mode}
	footer_actions={actions}
	fields={['jurisdiction_code', 'effective_from', 'law']}
	{...record === null ? { values: view.mode === 'create' ? view.values : {} } : { id: record.id }}
/>
