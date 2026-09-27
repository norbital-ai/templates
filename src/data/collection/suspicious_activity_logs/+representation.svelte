<script lang="ts">
	/**
	 * A finding: open or resolved, the judgement and the basis it was made on, and the controller's conclusion. An open
	 * one is closed by resolving it; a person raises one against a job with a reason.
	 */
	import { bolt } from '$bolt';
	import type { RecordView } from '@norbital-ai/ui';
	import { Field, Form, RecordShell } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import Icon from '@iconify/svelte';
	import { singaporeInstant } from '../../../lib/format.js';

	let { view }: { view: RecordView<'suspicious_activity_logs'> } = $props();
	const t = bolt.t;
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
			<section>
				<h4 class="text-xs font-medium text-muted-foreground">
					{t('component.suspicion_judgement')}
				</h4>
				<p class="text-sm whitespace-pre-wrap break-words">{record.reason}</p>
			</section>
			<section>
				<h4 class="text-xs font-medium text-muted-foreground">{t('component.suspicion_basis')}</h4>
				<p class="text-sm whitespace-pre-wrap break-words">{record.basis}</p>
			</section>
			{#if !open}
				<section>
					<h4 class="text-xs font-medium text-muted-foreground">
						{t('component.suspicion_resolution')}
					</h4>
					<p class="text-sm whitespace-pre-wrap">
						{record.resolution ?? t('component.suspicion_resolution_missing')}
					</p>
					<p class="text-meta">
						{t('component.suspicion_resolved_at', {
							instant: singaporeInstant(
								record.resolved_at == null ? null : String(record.resolved_at)
							)
						})}
					</p>
				</section>
			{:else}
				<Form
					of={{ action: 'suspicious_activity_logs.resolve' }}
					id={record.id}
					submit={t('component.suspicion_resolve')}
				/>
			{/if}
		</Stack>
	</RecordShell>
{/if}
