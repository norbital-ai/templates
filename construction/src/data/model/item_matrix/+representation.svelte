<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, RecordForm, type RecordView, Section } from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'item_matrix'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['category', 'discipline', 'unit']}>
	<Section icon="lucide:table-2" first name="rule" title={ctx.t('section.matrix_rate')}>
		<Grid minimum="card">
			<Field {ctx} name="code" />
			<Field {ctx} name="name" />
			<Field {ctx} name="category" />
			<Field {ctx} name="discipline" />
			<Field {ctx} name="trade_specialty" />
			<Field {ctx} name="active" />
		</Grid>
	</Section>

	<Section icon="lucide:calculator" name="pricing" title={ctx.t('section.quantifiable_pricing')}>
		<Grid minimum="card">
			<Field {ctx} name="unit" />
			<Field {ctx} name="quantity_basis" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="unit_rate" />
			<Field {ctx} name="waste_factor_pct" />
			<Field {ctx} name="carbon_factor" />
			<Field {ctx} name="rate_basis" />
			<Field {ctx} name="validity" />
		</Grid>
	</Section>

	<Section
		icon="lucide:sigma"
		name="derived"
		title={ctx.t('section.derived_quantity')}
		default_open={view.mode !== 'create' && view.record.quantity_basis === 'derived'}
	>
		<Grid minimum="card">
			<Field {ctx} name="derived_from" />
			<Field {ctx} name="ratio" />
			<Field {ctx} name="stands_in_for" />
		</Grid>
	</Section>

	<Section icon="lucide:box" name="matching" title={ctx.t('section.bim_classification_rules')}>
		<Grid minimum="card">
			<Field {ctx} name="ifc_classes" />
			<Field {ctx} name="match_keywords" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
