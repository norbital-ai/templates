<script lang="ts">
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view }: { view: RecordView<'certification_types'> } = $props();
</script>

<RecordForm {view} subtitle={['certification_code', 'issuing_body']}>
	<Field name="certification_name" />
	<Field name="certification_code" />
	<Field name="category" />
	<Field name="issuing_body" />
	<Field name="validity_period_months" />
	<Field name="requires_refresher" />
	<Column span="all"><Field name="description" /></Column>
</RecordForm>
