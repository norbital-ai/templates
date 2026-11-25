<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'source_purchase_lines'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm {ctx} {view} lock={ctx.t('component.kingdee_readonly')}>
	<Section first name="document">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="kind" />
			<Field {ctx} name="reference" />
			<Field {ctx} name="business_on" />
			<Field {ctx} name="supplier_name" />
			<Field {ctx} name="order_reference" />
			<Field {ctx} name="upstream" />
			<Field {ctx} name="active" />
		</Grid>
	</Section>
	<Section name="line">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="product_name" />
			<Field {ctx} name="lot_number" />
			<Field {ctx} name="warehouse_code" />
			<Field {ctx} name="quantity" />
			<Field {ctx} name="unit" />
			<Field {ctx} name="net_amount" />
			<Field {ctx} name="tax_amount" />
		</Grid>
	</Section>
	<Section name="payable">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="billed_amount" />
			<Field {ctx} name="open_amount" />
			<Field {ctx} name="due_on" />
			<Field {ctx} name="paid_on" />
		</Grid>
	</Section>
</RecordForm>
