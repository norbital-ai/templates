<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Field, Section, type RecordView } from '@norbital-ai/ui';
	import RecordForm from '../../../lib/record-form.svelte';

	let { view, ctx }: { view: RecordView<'communication_settings'>; ctx: PageContext } = $props();
</script>

<RecordForm {ctx} {view} subtitle={['hard_filter']}>
	<Section
		icon="lucide:list-filter"
		first
		name="intake"
		title={ctx.t('connections.intake_rules_title')}
	>
		<Grid minimum="compact">
			<Field {ctx} name="hard_filter" />
			<Field {ctx} name="auto_extract" />
			<Column span="all"><Field {ctx} name="classification_sop" /></Column>
		</Grid>
	</Section>
</RecordForm>
