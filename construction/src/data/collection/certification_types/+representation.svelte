<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let { view }: { view: RecordView<'certification_types'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['certification_code', 'issuing_body']}>
	<Section first name="certification" title={t('section.certification')}>
		<Grid minimum="compact">
			<Field name="certification_name" />
			<Field name="certification_code" />
			<Field name="category" />
			<Field name="issuing_body" />
			<Field name="validity_period_months" />
			<Field name="requires_refresher" />
		</Grid>
	</Section>
	<Section
		name="description"
		title={t('section.description')}
		defaultOpen={false}
		summary={record?.['description'] || t('section.no_description')}
	>
		<Grid minimum="compact">
			<Column span="all"><Field name="description" /></Column>
		</Grid>
	</Section>
</RecordForm>
