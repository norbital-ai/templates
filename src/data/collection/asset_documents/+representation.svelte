<script lang="ts">
	/** A handover document, and the project and work front it belongs to. */
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'asset_documents'> } = $props();
</script>

<RecordForm {view} subtitle={['document_number', 'status']}>
	<Field name="title" />
	<Field name="document_number" />
	<RefField name="project_id" ref="project" />
	<RefField name="site_location_id" ref="site" />
	<Field name="document_type" />
	<Field name="asset_category" />
	<Field name="asset_tag" />
	<Field name="status" />
	<Field name="version" />
	<Field name="document_url" />
	<Column span="all"><Field name="tags" /></Column>
	<Column span="all"><Field name="validity_range" /></Column>
</RecordForm>
