<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'compliance_records'>; ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const hideProject = $derived(
		record !== null || (view.mode === 'create' && view.values.project_id != null)
	);
</script>

<RecordForm {ctx} {view} subtitle={['standard', 'category', 'status']}>
	<Section
		icon="lucide:clipboard-check"
		first
		name="compliance_record"
		title={t('section.compliance_record')}
	>
		<Grid minimum="compact">
			{#if !hideProject}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="title" />
			<Field {ctx} name="recorded_on" />
			<Field {ctx} name="standard" />
			<Field {ctx} name="category" />
			<Field {ctx} name="clause_ref" />
			<Field {ctx} name="severity" />
			{#if record !== null}
				<Field {ctx} name="status" />
			{/if}
			<Field {ctx} name="owner" />
			<Field {ctx} name="closed_on" />
			<Column span="all"><Field {ctx} name="metric_value" /></Column>
			<Column span="all"><Field {ctx} name="corrective_action" /></Column>
		</Grid>
	</Section>
</RecordForm>
