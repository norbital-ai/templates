<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let { view, ctx }: { view: RecordView<'warehouses'>; ctx: PageContext } = $props();
</script>

<!-- a Kingdee mirror: only its sync writes it -->
<RecordForm {ctx} {view} lock={ctx.t('component.kingdee_readonly')}>
	<Section first name="warehouses">
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="name" />
			<Field {ctx} name="external_code" />
			<Field {ctx} name="source_number" />
			<Field {ctx} name="group_code" />
			<Field {ctx} name="group_name" />
			<Field {ctx} name="active" />
			<Field {ctx} name="source_updated_at" />
		</Grid>
	</Section>
</RecordForm>
