<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'source_payments'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm {ctx} {view} lock={ctx.t('component.kingdee_readonly')}>
	<Section first name="payment">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="order" />
			<Field {ctx} name="invoice" />
			<Field {ctx} name="reference" />
			<Field {ctx} name="kind" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="amount" />
			<Field {ctx} name="settled_on" />
			<Field {ctx} name="active" />
			<Field {ctx} name="source_updated_at" />
		</Grid>
	</Section>
</RecordForm>
