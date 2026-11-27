<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		RecordForm,
		type RecordView,
		Section,
		use_record_controller
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'sop_rules'>; ctx: PageContext } = $props();
	const controller = use_record_controller();
	const record = $derived(view.mode !== 'create' ? view.record : null);
	const scope = $derived(controller?.current?.get('scope') ?? record?.scope ?? 'element');
	const metric = $derived(controller?.current?.get('metric') ?? record?.metric ?? 'min_width_mm');
	const operator = $derived(
		String(controller?.current?.get('operator') ?? record?.operator ?? 'gte')
	);
	const usesNumericThreshold = $derived(
		metric !== 'semantic_check' && (operator === 'gte' || operator === 'lte' || operator === 'eq')
	);
	const usesTextThreshold = $derived(
		metric === 'semantic_check' || operator === 'contains' || operator === 'present'
	);
</script>

<RecordForm {ctx} {view} subtitle={['authority', 'severity', 'scope']}>
	<Section icon="lucide:shield-check" first name="rule" title={ctx.t('section.sop_rule')}>
		<Grid minimum="compact">
			<Field {ctx} name="code" />
			<Field {ctx} name="name" />
			<Field {ctx} name="authority" />
			<Field {ctx} name="severity" />
			<Field {ctx} name="active" />
			<Field {ctx} name="clause_ref" />
			<Column span="all"><Field {ctx} name="remediation" /></Column>
		</Grid>
	</Section>

	<Section icon="lucide:sliders-horizontal" name="condition" title={ctx.t('section.sop_condition')}>
		<Grid minimum="compact">
			<Field {ctx} name="scope" />
			<Field {ctx} name="metric" />
			<Field {ctx} name="operator" />
			{#if usesNumericThreshold}
				<Field {ctx} name="threshold_num" />
			{/if}
			{#if usesTextThreshold}
				{#if metric === 'semantic_check'}
					<Column span="all"><Field {ctx} name="threshold_text" /></Column>
				{:else}
					<Field {ctx} name="threshold_text" />
				{/if}
			{/if}
			{#if scope === 'element' || metric === 'semantic_check'}
				<Column span="all"><Field {ctx} name="ifc_classes" /></Column>
				<Column span="all"><Field {ctx} name="name_contains" /></Column>
				<Column span="all"><Field {ctx} name="service_filter" /></Column>
			{/if}
		</Grid>
	</Section>
</RecordForm>
