<script lang="ts">
	import { client } from '$bolt/client';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { CollectionRelationOptions } from '@norbital-ai/std/collection';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'CollectionForm');

	const { t } = useI18n<TenantI18nKeys>();

	const subtitle = $derived(
		record == null ? undefined : `${record.reference_code ?? '—'} · ${record.category ?? '—'}`
	);
</script>

<RecordShell title={record?.reference_name ?? 'New reference entry'} {subtitle}>
	<CollectionForm
		client={workspaceClient}
		collection="bim_reference_matrix"
		defaultValues={record ?? undefined}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Grid minimum="compact">
				<Field name="reference_name" />
				<Field name="reference_code" />
				<Field
					name="project_id"
					label={t('component.project')}
					relationOptions={{
						label: (record) => {
							const number = record.project_number;
							const name = record.project_name;
							if (number && name) return `${number} · ${name}`;
							const v = record.project_name;
							return v != null && v !== '' ? String(v) : '—';
						},
						orderBy: { project_number: 'asc' },
						limit: 500
					} satisfies CollectionRelationOptions}
				/>
				<Field name="category" />
				<Field name="subcategory" />
				<Field name="unit_of_measure" />
				<Field name="rate" />
				<Field name="embodied_carbon_per_unit" />
				<Field name="carbon_unit" />
				<Column span="all"><Field name="specification" /></Column>
				<Field name="bim_guid" />
				<Field name="data_source" />
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
