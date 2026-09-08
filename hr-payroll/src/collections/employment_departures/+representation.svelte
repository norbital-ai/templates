<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<RecordShell title={t('component.departure')}>
	<CollectionForm
		{client}
		collection="employment_departures"
		defaultValues={record ?? undefined}
		disabled={record != null}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Field name="employment_id" label={t('component.employment')} />
			<Field name="exit_date" label={t('component.exited')} />
			<Field name="exit_reason" label={t('component.exit_reason')} />
			<Field name="note" />
		{/snippet}
	</CollectionForm>
</RecordShell>
