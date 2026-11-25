<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Field,
		open_record,
		RecordForm,
		Section,
		type FormState,
		type InsertOf,
		type RecordView
	} from '@norbital-ai/ui';
	import { Grid } from '@norbital-ai/ui/layout';
	import { createValues } from '../../../../lib/ui/create-values.js';
	import FloorWarning from '../../../../lib/ui/floor-warning.svelte';
	let {
		view,
		ctx
	}: {
		view: RecordView<'pricing_floors'>;
		ctx: PageContext;
	} = $props();
	// a floor opened from the price book (`openCreate`) carries its region, currency and day: fixed, not asked
	const preset = createValues<'pricing_floors'>();
	const values: Partial<InsertOf<'pricing_floors'>> = $derived(
		view.mode === 'create' ? { ...preset, ...view.values } : {}
	);
	// the key fields stay visible after creation, readonly: only the price and its tax change
	const stored = $derived(view.mode !== 'create');
	let added = $state(0);
</script>

{#snippet warning(form: FormState)}<FloorWarning {ctx} {form} />{/snippet}
{#key added}
	<RecordForm
		{ctx}
		on_done={(o) => {
			if (view.mode !== 'create' || o.kind !== 'committed' || !o.records[0]) return;
			// a create its opener scopes stays open for the next one
			if (Object.keys(values).length > 0) added++;
			else open_record(view.model, o.records[0].id);
		}}
		view={view.mode === 'create' ? { ...view, values } : view}
		subtitle={['product', 'currency', 'unit']}
		form_actions={warning}
	>
		<Section first name="floor">
			<Grid gap="md" minimum="compact">
				<Field {ctx} name="product" readonly={stored} />
				{#if values.currency == null}<Field {ctx} name="currency" readonly={stored} />{/if}
				{#if values.group_code == null}<Field {ctx} name="group_code" readonly={stored} />{/if}
				{#if values.effective_on == null}<Field {ctx} name="effective_on" readonly={stored} />{/if}
				<Field {ctx} name="unit" readonly={stored} />
				<Field {ctx} name="floor_price" />
				<Field {ctx} name="tax_inclusive" />
				<Field {ctx} name="tax_rate" />
			</Grid>
		</Section>
	</RecordForm>{/key}
