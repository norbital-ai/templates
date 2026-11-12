<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'payment_claims'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
</script>

<RecordForm {ctx} {view} subtitle={['claim_type', 'status']}>
	<Section icon="lucide:receipt" first name="claim" title={ctx.t('section.claim')}>
		<Grid minimum="compact">
			<Field {ctx} name="claim_number" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.job_id == null}
				<Field {ctx} name="job_id" />
			{/if}
			<Field {ctx} name="claim_type" />
			<Field {ctx} name="status" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:banknote" name="amounts" title={ctx.t('section.amounts')}>
		<Grid minimum="compact">
			<Field {ctx} name="currency" />
			<Field {ctx} name="claimed_amount" />
			<Field {ctx} name="certified_amount" />
			<Field {ctx} name="claim_period" />
		</Grid>
	</Section>
	<Section
		icon="lucide:send"
		name="submission"
		title={ctx.t('section.submission')}
		default_open={false}
		summary={record?.['submitted_date'] ?? ctx.t('section.not_submitted')}
	>
		<Grid minimum="compact">
			<Field {ctx} name="submitted_date" />
			<Field {ctx} name="paid_date" />
		</Grid>
	</Section>
</RecordForm>
