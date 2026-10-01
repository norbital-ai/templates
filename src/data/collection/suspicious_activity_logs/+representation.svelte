<script lang="ts">
	/**
	 * A finding: open or resolved, the judgement and the basis it was made on, and the controller's conclusion. An open
	 * one is closed by resolving it; a person raises one against a job with a reason.
	 */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { Field, Form, format, RecordShell, Section, useKinds } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';

	let { view }: { view: RecordView<'suspicious_activity_logs'> } = $props();
	const t = bolt.t;
	const kinds = useKinds();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const open = $derived(record?.resolved_at == null);
</script>

{#if record == null}
	<RecordShell of="suspicious_activity_logs" mode="create">
		<Form of="suspicious_activity_logs" mode="create">
			{#snippet children()}
				<Grid minimum="panel">
					<Field name="job_assignment_id" label={t('component.job_assignment')} />
					<Field name="reason" label={t('component.suspicion_judgement')} />
				</Grid>
			{/snippet}
		</Form>
	</RecordShell>
{:else}
	<RecordShell
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
			<Section first name="judgement" title={t('component.suspicion_judgement')}>
				<p class="text-sm whitespace-pre-wrap break-words">{record.reason}</p>
			</Section>
			<Section
				name="basis"
				title={t('component.suspicion_basis')}
				defaultOpen={false}
				summary={record.basis || t('component.not_recorded')}
			>
				<p class="text-sm whitespace-pre-wrap break-words">{record.basis}</p>
			</Section>
			{#if !open}
				<Section name="resolution" title={t('component.suspicion_resolution')}>
					<p class="text-sm whitespace-pre-wrap">
						{record.resolution ?? t('component.suspicion_resolution_missing')}
					</p>
					<p class="text-meta">
						{t('component.suspicion_resolved_at', {
							instant:
								format({ kind: 'instant' }, record.resolved_at ?? null, {
									...kinds,
									locale: kinds.locale ?? bolt.locale
								}) || '—'
						})}
					</p>
				</Section>
			{:else}
				<Section name="resolution" title={t('component.suspicion_resolution')}>
					<Form
						of={{ action: 'suspicious_activity_logs.resolve' }}
						id={record.id}
						submit={t('component.suspicion_resolve')}
					/>
				</Section>
			{/if}
		</Stack>
	</RecordShell>
{/if}
