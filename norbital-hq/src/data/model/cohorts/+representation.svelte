<script lang="ts">
	/**
	 * A cohort: its sequence, status, Apollo sequence and counts; Launch pushes the sequence to Apollo and enrols the
	 * members, Sync brings their progress back (Norbius asks before either). Members are added while it is a draft or
	 * after launch (Launch again enrols the new ones); a lead in another active cohort is refused.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import type { RecordView } from '@norbital-ai/ui';
	import { Button, RecordShell, RunStatus, Sheet, Table, use_act } from '@norbital-ai/ui';
	let { view, ctx }: { view: RecordView<'cohorts'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const fields = [
		'name',
		'sequence',
		'status',
		'apollo_sequence_id',
		'launched_at',
		'synced_at',
		'member_count',
		'replied_count',
		'meeting_count',
		'stopped_count'
	] as const;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	let adding = $state(false);
	let run = $state<string | null>(null);
	let automation = $state<'launch_cohort' | 'sync_cohort'>('launch_cohort');
	const act = use_act(ctx);
	const start = (which: 'launch_cohort' | 'sync_cohort') => {
		if (record === null) return;
		const handle = ctx.run(which, { cohort: record.id });
		automation = which;
		run = handle.id;
		act.run(handle);
	};
</script>

{#snippet header()}
	{#if record && record.status !== 'done'}
		<Button onclick={() => start('launch_cohort')} disabled={act.pending}
			>{t(record.status === 'draft' ? 'cohorts.launch' : 'cohorts.enrol_new')}</Button
		>
	{/if}
	{#if record?.apollo_sequence_id}
		<Button variant="outline" onclick={() => start('sync_cohort')} disabled={act.pending}
			>{t('cohorts.sync')}</Button
		>
	{/if}
	{#if run}<RunStatus {ctx} {automation} {run} />{/if}
{/snippet}
{#snippet members()}
	{#if record}<Table
			{ctx}
			of="cohort_members"
			key="cohort-members"
			toolbar={{ new: record.status === 'done' ? false : () => (adding = true) }}
			where={{ cohort: { eq: record.id } }}
			columns={[
				'contact',
				'company',
				'enrolled_on',
				'step',
				'replied',
				'meeting_booked',
				'stopped',
				'projects_sent'
			]}
		/>{/if}
{/snippet}
{#if record === null}
	<RecordShell
		{ctx}
		of="cohorts"
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
		fields={['name', 'sequence', 'apollo_sequence_id']}
	/>
{:else}
	<RecordShell
		{ctx}
		of="cohorts"
		id={record.id}
		{fields}
		sections={[
			{
				name: 'cohort',
				icon: 'lucide:users-round',
				title: t('models.cohorts.singular'),
				hint: t('cohorts.apollo_hint'),
				fields: ['name', 'sequence', 'status', 'apollo_sequence_id', 'launched_at', 'synced_at']
			},
			{
				name: 'counts',
				icon: 'lucide:chart-column',
				title: t('cohorts.counts'),
				fields: ['member_count', 'replied_count', 'meeting_count', 'stopped_count']
			}
		]}
		actions={header}
		tabs={[
			{
				name: 'members',
				title: t('cohorts.members'),
				icon: 'lucide:user-round-check',
				body: members
			}
		]}
	/>
{/if}

<Sheet
	open={adding}
	on_open_change={(open) => {
		if (!open) adding = false;
	}}
	title={t('cohorts.add_member')}
>
	{#if record && adding}
		<RecordShell
			{ctx}
			of="cohort_members"
			mode="create"
			values={{ cohort: record.id }}
			fields={['cohort', 'contact']}
			on_done={() => (adding = false)}
		/>
	{/if}
</Sheet>
