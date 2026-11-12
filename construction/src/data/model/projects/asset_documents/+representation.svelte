<script lang="ts">
	/** A handover document, and the project and work front it belongs to. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'asset_documents'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {ctx} {view} subtitle={['document_number', 'status']}>
	<Section icon="lucide:file-text" first name="document" title={ctx.t('section.document')}>
		<Grid minimum="compact">
			<Field {ctx} name="title" />
			<Field {ctx} name="document_number" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field {ctx} name="site_location_id" />
			{/if}
			<Field {ctx} name="document_type" />
			<Field {ctx} name="status" />
			<Field {ctx} name="version" />
			<Field {ctx} name="document_url" />
			<Column span="all"><Field {ctx} name="validity_range" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:tags"
		name="classification"
		title={ctx.t('section.classification')}
		default_open={false}
		summary={record?.['asset_tag'] || ctx.t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field {ctx} name="asset_category" />
			<Field {ctx} name="asset_tag" />
			<Column span="all"><Field {ctx} name="tags" /></Column>
		</Grid>
	</Section>
</RecordForm>
