<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'cost_items'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['item_code', 'cost_group', 'claim_basis']}>
	<Section icon="lucide:calculator" first name="cost" title={ctx.t('section.cost_item')}>
		<Grid minimum="compact">
			<Field {ctx} name="item_code" />
			<Field {ctx} name="description" />
			{#if view.mode !== 'create' || view.values.project_id == null}
				<Field {ctx} name="project_id" />
			{/if}
			<Field {ctx} name="cost_group" />
			<Field {ctx} name="zone" />
			<Field {ctx} name="unit" />
		</Grid>
	</Section>
	<Section icon="lucide:banknote" name="valuation" title={ctx.t('section.costing_and_claimable')}>
		<Grid minimum="compact">
			<Field {ctx} name="currency" />
			<Field {ctx} name="contract_qty" />
			<Field {ctx} name="unit_rate" />
			<Field {ctx} name="contract_amount" readonly />
			<Field {ctx} name="claim_basis" />
			<Field {ctx} name="progress_pct" />
			<Field {ctx} name="completed_qty" />
			<Field {ctx} name="claimable_amount" readonly />
			<Field {ctx} name="retention_exempt" />
			<Column span="all"><Field {ctx} name="notes" /></Column>
		</Grid>
	</Section>
</RecordForm>
