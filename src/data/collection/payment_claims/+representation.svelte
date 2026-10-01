<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section } from '@norbital-ai/ui';
	import type { RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	import RefField from '../../../lib/ref-field.svelte';
	let { view }: { view: RecordView<'payment_claims'> } = $props();
	const t = bolt.t;
	const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordForm {view} subtitle={['claim_type', 'status']}>
	<Section first name="claim" title={t('section.claim')}>
		<Grid minimum="compact">
			<Field name="claim_number" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<RefField name="project_id" ref="project" />
			{/if}
			{#if view.mode !== 'create' || view.values.job_id == null}
				<RefField name="job_id" ref="job" />
			{/if}
			<Field name="claim_type" />
			<Field name="status" />
		</Grid>
	</Section>
	<Section name="amounts" title={t('section.amounts')}>
		<Grid minimum="compact">
			<Field name="currency" />
			<Field name="claimed_amount" />
			<Field name="certified_amount" />
			<Field name="claim_period" />
		</Grid>
	</Section>
	<Section
		name="submission"
		title={t('section.submission')}
		defaultOpen={false}
		summary={record?.['submitted_date'] ?? t('section.not_submitted')}
	>
		<Grid minimum="compact">
			<Field name="submitted_date" />
			<Field name="paid_date" />
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
