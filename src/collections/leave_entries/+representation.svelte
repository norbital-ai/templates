<script lang="ts">
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { client } from '../../lib/workspace-client.js';
	import type { RepresentationProps } from './$types.js';
	import { todayKey } from '../../lib/ui/calendar.js';

	let { record }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const manualSourceKey = `manual:${crypto.randomUUID()}`;
	const defaultValues = $derived(
		record ?? {
			kind: 'MANUAL_ADJUSTMENT' as const,
			effective_on: todayKey(),
			source_key: manualSourceKey
		}
	);
</script>

<RecordShell title={record?.kind ?? t('component.create_leave_entry')}>
	<CollectionForm {client} collection="leave_entries" {defaultValues} disabled={record != null}>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field name="leave_entitlement_id" label={t('component.leave_entitlement')} />
				<Field name="kind" label={t('component.movement')} hidden={record == null} />
				<Field name="effective_on" label={t('component.effective_date')} />
				<Field name="days" label={t('component.days')} />
				<Field name="source_key" label={t('component.reference')} />
				<Column span="all"><Field name="reason" label={t('component.reason')} /></Column>
				{#if record != null}
					<Field name="expires_on" label={t('component.expires')} />
					<Field name="source_request_id" label={t('component.leave_request')} />
				{/if}
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
