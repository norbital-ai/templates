<script lang="ts">
	import { Column } from '@norbital-ai/ui/layout';
	import { Field } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'bim_reference_matrix'> } = $props();
</script>

<RecordForm {view} subtitle={['reference_code', 'category']}>
	<Field name="reference_name" />
	<Field name="reference_code" />
	<RefField name="project_id" ref="project" />
	<Field name="category" />
	<Field name="subcategory" />
	<Field name="unit_of_measure" />
	<Field name="currency" />
	<Field name="rate" />
	<Field name="embodied_carbon_per_unit" />
	<Field name="carbon_unit" />
	<Column span="all"><Field name="specification" /></Column>
	<Field name="bim_guid" />
	<Field name="data_source" />
</RecordForm>
