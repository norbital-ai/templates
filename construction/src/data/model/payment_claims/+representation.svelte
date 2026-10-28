<script lang="ts">
	import { bolt } from '$bolt';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';
	let {
		view
	}: {
		view: RecordView<'payment_claims'>;
	} = $props();
	const t = bolt.t;
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {view} subtitle={['claim_type', 'status']}>
	<Section first name="claim" title={t('section.claim')}>
		<Grid minimum="compact">
			<Field name="claim_number" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.job_id == null}
				<Field name="job_id" />
			{/if}
			<Field name="claim_type" />
			<Field name="status" />
			<Column span="all"><Field name="description" /></Column>
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
</RecordForm>
