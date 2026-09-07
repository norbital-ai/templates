<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<RecordShell
	title={record ? `${record.code} · ${record.name}` : t('component.create_shift_pattern')}
>
	<CollectionForm
		{client}
		collection="shift_patterns"
		defaultValues={record ?? undefined}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid gap="md" minimum="compact">
				<Field
					name="company_id"
					label={t('component.company')}
					relationOptions={{
						label: (record) =>
							record.name != null && record.name !== '' ? String(record.name) : '—',
						orderBy: { name: 'asc' },
						limit: 500
					}}
				/>
				<Field name="code" />
				<Field name="name" />
				<!-- The day cycle picks from the company's roster codes; the renderer reads `company_id` off the row. -->
				<Column span="all"><Field name="pattern" label={t('component.work_pattern')} /></Column>
				<Column span="all"
					><Field name="effective_range" label={t('component.effective_period')} /></Column
				>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
