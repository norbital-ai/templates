<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'certification_types'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['certification_code', 'issuing_body']}>
	<Section first>
		<Grid minimum="compact">
			<Field {ctx} name="certification_name" />
			<Field {ctx} name="certification_code" />
			<Field {ctx} name="category" />
			<Field {ctx} name="issuing_body" />
			<Field {ctx} name="validity_period_months" />
			<Field {ctx} name="requires_refresher" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
</RecordForm>
