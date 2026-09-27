<script lang="ts">
	/** A handover document, and the project and work front it belongs to. */
	import { Column } from '@norbital-ai/ui/layout';
	import { bolt } from '$bolt';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'asset_documents'> } = $props();
</script>

<RecordForm {view} subtitle={['document_number', 'status']}>
	<Field name="title" label={bolt.t('component.title')} />
	<Field name="document_number" label={bolt.t('component.document_number')} />
	<RefField name="project_id" ref="project" />
	<RefField name="site_location_id" ref="site" />
	<Field name="document_type" label={bolt.t('component.document_type')} />
	<Field name="asset_category" label={bolt.t('component.asset_category')} />
	<Field name="asset_tag" label={bolt.t('component.asset_tag')} />
	<Field name="status" label={bolt.t('component.status')} />
	<Field name="version" label={bolt.t('component.version')} />
	<Field name="document_url" label={bolt.t('component.location')} />
	<Column span="all"><Field name="tags" label={bolt.t('component.tags')} /></Column>
	<Column span="all"><Field name="validity_range" label={bolt.t('component.valid_for')} /></Column>
</RecordForm>
