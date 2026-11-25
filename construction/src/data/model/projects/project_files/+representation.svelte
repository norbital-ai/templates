<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, RecordForm, type RecordView, Section } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'project_files'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
</script>

<RecordForm {ctx} {view} subtitle={['kind', 'current_version', 'status']}>
	<Section icon="lucide:file-text" first name="file" title={ctx.t('section.project_file')}>
		<Grid minimum="card">
			<Field {ctx} name="document_number" />
			<Field {ctx} name="title" />
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="kind" />
			<Field {ctx} name="discipline" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="zone" />
			<Field {ctx} name="current_version" />
			<Field {ctx} name="autodesk_urn" />
			<Column span="all"><Field {ctx} name="file" /></Column>
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
