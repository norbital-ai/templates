<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';
	let { view, ctx }: { view: RecordView<'permits_to_work'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['permit_type', 'status']}>
	<Section icon="lucide:shield-check" first name="permit" title={ctx.t('section.permit')}>
		<Grid minimum="compact">
			<Field {ctx} name="permit_number" />
			<Field {ctx} name="permit_type" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.site_location_id == null}
				<Field {ctx} name="site_location_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.job_id == null}
				<Field {ctx} name="job_id" />
			{/if}
			{#if view.mode !== 'create' || view.values.worker_id == null}
				<Field {ctx} name="worker_id" />
			{/if}
			<Field {ctx} name="status" />
		</Grid>
	</Section>
	<Section icon="lucide:calendar-check" name="validity" title={ctx.t('section.validity')}>
		<Grid minimum="compact">
			<Field {ctx} name="requested_date" />
			<Field {ctx} name="validity_range" />
			<Field {ctx} name="approved_by" />
		</Grid>
	</Section>
	<Section icon="lucide:pen-line" name="signoff" title={ctx.t('section.signoff')}>
		<Field {ctx} name="signatures" />
	</Section>
</RecordForm>
