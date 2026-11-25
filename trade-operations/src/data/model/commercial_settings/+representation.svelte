<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, RecordForm, Section, type RecordView } from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	let {
		view,
		ctx
	}: {
		view: RecordView<'commercial_settings'>;
		ctx: PageContext;
	} = $props();
</script>

<RecordForm {ctx} {view}>
	<Section first name="controls" icon="lucide:sliders-horizontal" title={ctx.t('section.general')}>
		<Grid gap="md" minimum="compact">
			<Field {ctx} name="freight_treatment" />
			<Field {ctx} name="floor_rule" />
		</Grid>
	</Section>
</RecordForm>
