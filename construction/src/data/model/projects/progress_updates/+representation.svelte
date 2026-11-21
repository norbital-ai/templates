<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'progress_updates'>; ctx: PageContext } = $props();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const contextSummary = $derived(
		[record?.reported_by, record?.weather, record?.headcount != null ? `${record.headcount}` : null]
			.filter(Boolean)
			.join(' · ') || undefined
	);
</script>

<RecordForm {ctx} {view} subtitle={['update_date', 'category']}>
	<Section icon="lucide:trending-up" first name="update" title={ctx.t('section.progress_update')}>
		<Grid minimum="compact">
			<Field {ctx} name="title" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="update_date" />
			<Field {ctx} name="category" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="task_id" />
			<Field {ctx} name="cost_item_id" />
			<Field {ctx} name="reported_progress_pct" />
			<Field {ctx} name="measured_quantity" />
			<Column span="all"><Field {ctx} name="summary" /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:cloud-sun"
		name="site_context"
		title={ctx.t('section.site_context_and_photos')}
		default_open={false}
		{...contextSummary ? { summary: contextSummary } : {}}
	>
		<Grid minimum="compact">
			<Field {ctx} name="headcount" />
			<Field {ctx} name="weather" />
			<Field {ctx} name="reported_by" />
			<Field {ctx} name="source_message_id" />
			<Column span="all"><Field {ctx} name="photos" /></Column>
		</Grid>
	</Section>
</RecordForm>
