<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import CatalogField from '../settings/catalog_field.svelte';
	import { paidPeriods } from '../payroll/paid_period.svelte.js';
	import ScopedEmploymentField from './scoped_employment_field.svelte';

	let {
		ctx,
		target,
		gridFields,
		bodyFields
	}: {
		ctx: PageContext;
		target:
			| { readonly of: 'adhoc_catalog_entry'; readonly view: RecordView<'adhoc_catalog_entry'> }
			| { readonly of: 'claim_catalog_entry'; readonly view: RecordView<'claim_catalog_entry'> };
		gridFields: readonly string[];
		bodyFields: readonly string[];
	} = $props();
	const paid = paidPeriods(ctx);
	const record = $derived(target.view.mode === 'create' ? null : target.view.record);
	const fixedEntity = $derived(
		record?.entity_id ??
			(target.view.mode === 'create' && typeof target.view.values.entity_id === 'string'
				? target.view.values.entity_id
				: null)
	);
	const fixedEmployment = $derived(
		target.view.mode === 'create' && typeof target.view.values.employment_id === 'string'
			? target.view.values.employment_id
			: null
	);
</script>

{#snippet fields(catalog: 'adhoc_catalog' | 'claim_catalog')}
	<Stack gap="md">
		<Grid minimum="card">
			{#if record === null && fixedEntity === null}<Field {ctx} name="entity_id" />{/if}
			{#if record === null}<ScopedEmploymentField
					{ctx}
					entityId={fixedEntity}
					disabled={fixedEmployment !== null}
				/>{/if}
			<CatalogField {ctx} of={catalog} dated="incurred_on" />
			{#each gridFields as name (name)}<Field {ctx} {name} />{/each}
		</Grid>
		{#each bodyFields as name (name)}<Field {ctx} {name} />{/each}
	</Stack>
{/snippet}

{#if target.of === 'adhoc_catalog_entry'}
	{@const rec = target.view.mode === 'create' ? null : target.view.record}
	<RecordShell
		{ctx}
		of="adhoc_catalog_entry"
		mode={target.view.mode}
		{...rec === null
			? { values: target.view.mode === 'create' ? target.view.values : {} }
			: { id: rec.id }}
	>
		<Form
			{ctx}
			of="adhoc_catalog_entry"
			mode={target.view.mode}
			size="content"
			{...rec === null
				? { values: target.view.mode === 'create' ? target.view.values : {} }
				: { id: rec.id, record: rec }}
			confirm={paid.confirm(() => rec?.payroll_run_id != null, ['incurred_on'])}
		>
			{#snippet children()}{@render fields('adhoc_catalog')}{/snippet}
		</Form>
	</RecordShell>
{:else}
	{@const rec = target.view.mode === 'create' ? null : target.view.record}
	<RecordShell
		{ctx}
		of="claim_catalog_entry"
		mode={target.view.mode}
		{...rec === null
			? { values: target.view.mode === 'create' ? target.view.values : {} }
			: { id: rec.id }}
	>
		<Form
			{ctx}
			of="claim_catalog_entry"
			mode={target.view.mode}
			size="content"
			{...rec === null
				? { values: target.view.mode === 'create' ? target.view.values : {} }
				: { id: rec.id, record: rec }}
			confirm={paid.confirm(() => rec?.payroll_run_id != null, ['incurred_on'])}
		>
			{#snippet children()}{@render fields('claim_catalog')}{/snippet}
		</Form>
	</RecordShell>
{/if}
