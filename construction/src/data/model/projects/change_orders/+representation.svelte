<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'change_orders'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const bimSummary = $derived(record?.bim_pin?.element_name ?? undefined);
</script>

<RecordForm {ctx} {view} subtitle={['change_number', 'change_type', 'status']}>
	<Section icon="lucide:git-pull-request" first name="change" title={ctx.t('section.change_order')}>
		<Grid minimum="compact">
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="change_type" />
			<Field {ctx} name="status" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="cost_item_id" />
			<Column span="all"><Field {ctx} name="description" /></Column>
		</Grid>
	</Section>
	<Section icon="lucide:banknote" name="impact" title={ctx.t('section.commercial_and_time_impact')}>
		<Grid minimum="compact">
			<Field {ctx} name="currency" />
			<Field {ctx} name="cost_impact" />
			<Field {ctx} name="schedule_impact_days" />
			<Field {ctx} name="requested_by" />
			<Field {ctx} name="effective_date" />
			<Field {ctx} name="approved_date" />
			<Column span="all"><Field {ctx} name="lines" /></Column>
			<Column span="all"><Field {ctx} name="justification" /></Column>
			<Column span="all"><Field {ctx} name="attachments" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:box"
		name="bim_and_source"
		title={ctx.t('section.bim_tag')}
		default_open={false}
		{...bimSummary ? { summary: bimSummary } : {}}
	>
		<Grid minimum="compact">
			<Field {ctx} name="bim_file_id" />
			<Field {ctx} name="source_message_id" />
			<Column span="all"><Field {ctx} name="bim_pin" /></Column>
		</Grid>
	</Section>
</RecordForm>
