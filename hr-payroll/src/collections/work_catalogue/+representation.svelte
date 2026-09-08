<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<RecordShell title={record?.code ?? t('app.settings.work_catalogue')}>
	<CollectionForm
		{client}
		collection="work_catalogue"
		defaultValues={record ?? undefined}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="panel">
				<Field name="settings_id" label={t('component.settings_version')} />
				<Field name="code" label={t('component.code')} />
				<Field name="proration" label={t('component.proration_basis')} />
				<Field name="ordinary_rate" label={t('component.ordinary_rate')} />
				<Column span="all"
					><Field name="regime" label={t('component.settings_section_regime')} /></Column
				>
				<Column span="all"><Field name="salary" label={t('work.output_salary')} /></Column>
				<Column span="all"><Field name="overtime" label={t('work.output_overtime')} /></Column>
				<Column span="all"
					><Field name="overtime_excess" label={t('work.output_overtime_excess')} /></Column
				>
				<Column span="all"><Field name="absence" label={t('work.output_absence')} /></Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
