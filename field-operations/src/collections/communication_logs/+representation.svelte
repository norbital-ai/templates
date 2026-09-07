<script lang="ts">
	/**
	 * One immutable inbound field message, presented as evidence rather than an editable UUID form.
	 * Provider message identifiers remain audit metadata and are intentionally absent from the panel.
	 */
	import { collectionClient } from '../../lib/collection-client.js';
	import { jobAssignmentLabel } from '../../lib/job-assignment-label.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record }: RepresentationProps = $props();

	const { t } = useI18n<TenantI18nKeys>();
	const subtitle = $derived(record == null ? undefined : `${record.sender} · ${record.sent_at}`);
</script>

<RecordShell title={record?.message ?? 'New message'} {subtitle}>
	{#if record}
		<CollectionForm
			client={collectionClient}
			collection="communication_logs"
			defaultValues={record}
			disabled
		>
			{#snippet children({ Field })}
				<Field name="source_message_id" hidden />
				<Grid minimum="compact">
					<Column span="all">
						<Field
							name="job_assignment_id"
							label={t('component.job_assignment')}
							relationOptions={{
								label: jobAssignmentLabel,
								orderBy: { dispatched_at: 'desc' },
								limit: 500
							}}
						/>
					</Column>
					<Field name="sender" label={t('component.communication_sender')} />
					<Field name="sent_at" label={t('component.communication_sent_at')} />
					<Column span="all">
						<Field name="message" label={t('component.communication_message')} />
					</Column>
				</Grid>
			{/snippet}
		</CollectionForm>
	{:else}
		<p class="text-sm text-muted-foreground">
			{t('component.communication_recorded_automatically')}
		</p>
	{/if}
</RecordShell>
