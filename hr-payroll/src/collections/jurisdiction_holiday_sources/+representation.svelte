<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<RecordShell title={t('holiday_source.title')}>
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{t('holiday_source.description')}</p>
		<CollectionForm
			{client}
			collection="jurisdiction_holiday_sources"
			defaultValues={record ?? { enabled: true }}
			onAfterSubmit={record ? undefined : close}
		>
			{#snippet children({ Field })}
				<Grid gap="md" minimum="compact">
					<Field name="jurisdiction_code" label={t('holiday_calendar.jurisdiction')} />
					<Field name="calendar_id" label={t('holiday_source.calendar_id')} />
					<Field name="time_zone" label={t('holiday_source.time_zone')} />
					<Field name="enabled" label={t('holiday_source.enabled')} />
				</Grid>
			{/snippet}
		</CollectionForm>
	</Stack>
</RecordShell>
