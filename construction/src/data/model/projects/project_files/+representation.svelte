<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'project_files'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const revCount = $derived(record?.revisions?.length ?? 0);
</script>

<RecordForm {ctx} {view} subtitle={['document_number', 'kind', 'current_version', 'status']}>
	<Section icon="lucide:file-box" first name="file" title={ctx.t('section.project_file')}>
		<Grid minimum="compact">
			<Field {ctx} name="document_number" />
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="kind" />
			<Field {ctx} name="discipline" />
			<Field {ctx} name="status" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="current_version" />
			<Column span="all"><Field {ctx} name="file" /></Column>
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
	{#if record && revCount > 0}
		<Section
			icon="lucide:history"
			name="revisions"
			title={ctx.t('project_files.revision_history')}
			default_open={false}
			summary={ctx.t('project_files.revision_count', { count: revCount })}
		>
			<Field {ctx} name="revisions" readonly />
		</Section>
	{/if}
</RecordForm>
