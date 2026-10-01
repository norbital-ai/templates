<script lang="ts">
	/** A handover document, and the project and work front it belongs to. */
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'asset_documents'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['document_number', 'status']}>
	<Section first name="document" title={t('section.document')}>
		<Grid minimum="compact">
			<Field name="title" />
			<Field name="document_number" />
			<RefField name="project_id" ref="project" />
			<RefField name="site_location_id" ref="site" />
			<Field name="document_type" />
			<Field name="status" />
			<Field name="version" />
			<Field name="document_url" />
			<Column span="all"><Field name="validity_range" /></Column>
		</Grid>
	</Section>
	<Section
		name="classification"
		title={t('section.classification')}
		defaultOpen={false}
		summary={record?.['asset_tag'] || t('component.not_set')}
	>
		<Grid minimum="compact">
			<Field name="asset_category" />
			<Field name="asset_tag" />
			<Column span="all"><Field name="tags" /></Column>
		</Grid>
	</Section>
</RecordForm>
