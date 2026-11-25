<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'stock_snapshots'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm {ctx} {view} lock={ctx.t('component.kingdee_readonly')}>
	<Section first name="stock_snapshots">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="product" />
			<Field {ctx} name="warehouse" />
			<Field {ctx} name="lot_number" />
			<Field {ctx} name="unit" />
			<Field {ctx} name="on_hand" />
			<Field {ctx} name="erp_committed" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="unit_cost" />
			<Field {ctx} name="external_code" />
			<Field {ctx} name="as_of" />
			<Field {ctx} name="orders_as_of" />
		</Grid>
	</Section>
</RecordForm>
