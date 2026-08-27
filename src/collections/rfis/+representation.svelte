<script lang="ts">
	import { client } from '$bolt/client';
	import { getCollectionClientForSurface } from '@norbital-ai/ui/collection-runtime';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import type { CollectionRelationOptions } from '@norbital-ai/std/collection';

	let { record, close }: RepresentationProps = $props();

	const workspaceClient = getCollectionClientForSurface(client, 'CollectionForm');

	const { t } = useI18n<TenantI18nKeys>();
</script>

<CollectionForm
	client={workspaceClient}
	collection="rfis"
	defaultValues={record ?? undefined}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="subject" hidden />
		<Field name="submitted_date" hidden />
		<Field name="resolved_date" hidden />
		<Field name="attachments" hidden />
		<Field name="related_defect_id" hidden />
		<Grid minimum="compact">
			<Field name="rfi_number" />
			<Field name="title" />
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
			<Field name="status" />
			<Field name="priority" />
			<Field name="asked_by" />
			<Field name="assigned_to" />
			<Field name="due_date" />
			<Column span="all"><Field name="question" /></Column>
			<Column span="all"><Field name="answer" /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
