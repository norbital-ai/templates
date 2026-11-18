<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, RecordShell, use_act, type RecordView } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'tasks'>; ctx: PageContext } = $props();
	const act = use_act(ctx);
	const record = $derived(view.mode === 'create' ? null : view.record);
	const moves = $derived(
		view.mode === 'view'
			? [
					...(view.capabilities?.moves.status ?? []),
					...(view.capabilities?.proposal_moves.status ?? [])
				]
			: []
	);
	const transitions = [
		['done', 'tasks.complete'],
		['open', 'tasks.reopen'],
		['cancelled', 'tasks.cancel']
	] as const;
	const sections = [
		{
			name: 'task',
			fields: ['subject', 'kind', 'due_on', 'owner', 'status', 'detail', 'attachments']
		},
		{
			name: 'context',
			title: ctx.t('tasks.context'),
			fields: ['company', 'project_id', 'contact_id', 'meeting']
		}
	];
</script>

{#snippet actions()}
	{#each transitions.filter(([status]) => moves.includes(status)) as [status, label] (status)}
		<Button
			variant="outline"
			disabled={act.pending}
			onclick={() => {
				if (record !== null)
					act.run(ctx.act({ 'tasks.update': [{ target: record, set: { status } }] }));
			}}>{ctx.t(label)}</Button
		>
	{/each}
{/snippet}

<RecordShell
	{ctx}
	of="tasks"
	{...view.mode === 'create'
		? { mode: 'create' as const, values: view.values }
		: { id: view.record.id }}
	{sections}
	footer_actions={actions}
/>
