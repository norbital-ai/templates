<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'credit_snapshots'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm {ctx} {view} lock={ctx.t('component.kingdee_readonly')}>
	<Section first name="credit_snapshots">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="party" />
			<Field {ctx} name="currency" />
			<Field {ctx} name="credit_limit" />
			<Field {ctx} name="credit_used" />
			<Field {ctx} name="credit_available" />
			<Field {ctx} name="credit_hold" />
			<Field {ctx} name="external_code" />
			<Field {ctx} name="as_of" />
		</Grid>
	</Section>
</RecordForm>
