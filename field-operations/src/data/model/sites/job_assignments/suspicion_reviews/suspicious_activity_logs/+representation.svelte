<script lang="ts">
	/**
	 * A finding: open or resolved, the judgement and the basis it was made on, and the controller's conclusion. An open
	 * one is closed by resolving it; a person raises one against a job with a reason.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { type RecordView, Field, Form, format, RecordShell, Section } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import EvidenceBasis from '../../../../../../lib/evidence-basis.svelte';
	let {
		ctx,
		view
	}: {
		ctx: PageContext;
		view: RecordView<'suspicious_activity_logs'>;
	} = $props();
	const t = ctx.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const open = $derived(record?.resolved_at == null);
</script>

{#if record == null}
	<RecordShell {ctx} of="suspicious_activity_logs" mode="create">
		<Form {ctx} of="suspicious_activity_logs" mode="create">
			{#snippet children()}
				<Grid minimum="card">
					<Field {ctx} name="job_assignment_id" label={t('component.job_assignment')} />
					<Field {ctx} name="reason" label={t('component.suspicion_judgement')} />
				</Grid>
			{/snippet}
		</Form>
	</RecordShell>
{:else}
	<RecordShell
		{ctx}
		of="suspicious_activity_logs"
		id={record.id}
		subtitle={open ? t('component.suspicion_open') : t('component.suspicion_resolved')}
	>
		<Stack gap="md">
			<p class="text-sm font-semibold">
				<Icon
					icon={open ? 'lucide:shield-alert' : 'lucide:shield-check'}
					class={open ? 'inline size-4 text-warning' : 'inline size-4'}
				/>
				{open ? t('component.suspicion_open') : t('component.suspicion_resolved')}
			</p>
			<Section
				icon="lucide:gavel"
				first
				name="judgement"
				title={t('component.suspicion_judgement')}
			>
				<p class="text-sm whitespace-pre-wrap break-words">{record.reason}</p>
			</Section>
			<Section
				icon="lucide:list-checks"
				name="basis"
				title={t('component.suspicion_basis')}
				default_open={false}
				size="fill"
				summary={record.basis?.kind === 'human_judgement'
					? record.basis.reason
					: (record.basis?.job.title ?? t('component.not_recorded'))}
			>
				{#if record.basis?.kind === 'review'}
					<EvidenceBasis {ctx} basis={record.basis} job={record.job_assignment_id} />
				{:else}
					<p class="text-sm break-words whitespace-pre-wrap">
						{record.basis?.reason ?? t('component.not_recorded')}
					</p>
				{/if}
			</Section>
			{#if !open}
				<Section
					icon="lucide:circle-check"
					name="resolution"
					title={t('component.suspicion_resolution')}
				>
					<p class="text-sm whitespace-pre-wrap">
						{record.resolution ?? t('component.suspicion_resolution_missing')}
					</p>
					<p class="text-meta">
						{t('component.suspicion_resolved_at', {
							instant:
								format({ kind: 'instant' }, record.resolved_at ?? null, {
									locale: ctx.locale,
									zone: ctx.tz
								}) || '—'
						})}
					</p>
				</Section>
			{:else}
				<Section
					icon="lucide:circle-check"
					name="resolution"
					title={t('component.suspicion_resolution')}
				>
					<Form
						{ctx}
						of={{ automation: 'suspicious_activity_logs_resolve' }}
						values={{ finding: [record.id] }}
						fields={['resolution']}
						submit={t('component.suspicion_resolve')}
					/>
				</Section>
			{/if}
		</Stack>
	</RecordShell>
{/if}
