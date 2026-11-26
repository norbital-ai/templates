<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import {
		Field,
		Picker,
		RecordForm,
		type FieldEditor,
		type RecordView,
		Section
	} from '@norbital-ai/ui';

	let { view, ctx }: { view: RecordView<'asset_mappings'>; ctx: PageContext } = $props();
</script>

{#snippet itemEditor(field: FieldEditor)}
	<Picker
		{ctx}
		of="item_matrix"
		id={field.id}
		where={{
			category: { eq: 'bim_asset' },
			quantity_basis: { ne: 'derived' },
			active: { eq: true }
		}}
		value={typeof field.value === 'string' ? field.value : null}
		disabled={field.disabled}
		invalid={field.error !== undefined}
		on_change={(next) => field.on_change(next)}
	/>
{/snippet}

<RecordForm {ctx} {view} subtitle={['ifc_class', 'continuity', 'review_status']}>
	<Section icon="lucide:shapes" first name="asset" title={ctx.t('section.asset_priced_as')}>
		<Grid minimum="compact">
			<Field {ctx} name="item_id" editor={itemEditor} />
			<Field {ctx} name="review_status" />
			<Field {ctx} name="source" readonly />
			<Field {ctx} name="confidence" readonly />
			<Column span="all"><Field {ctx} name="note" /></Column>
			<Column span="all"><Field {ctx} name="picture" readonly /></Column>
		</Grid>
	</Section>
	<Section
		icon="lucide:fingerprint"
		name="identity"
		title={ctx.t('section.asset_identity')}
		default_open={true}
	>
		<Grid minimum="compact">
			<Field {ctx} name="label" readonly />
			<Field {ctx} name="ifc_class" />
			<Field {ctx} name="continuity" />
			<Field {ctx} name="service" />
			<Field {ctx} name="size_mm" readonly />
			<Column span="all"><Field {ctx} name="cleanup_note" readonly /></Column>
			<Column span="all"><Field {ctx} name="signature" readonly /></Column>
		</Grid>
	</Section>
</RecordForm>
