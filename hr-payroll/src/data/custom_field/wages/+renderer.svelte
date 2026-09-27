<script lang="ts">
	/**
	 * Regional minimum wages of one settings version: one row per region, in the
	 * version's currency. A company names its region and a scheme's floor or cap reads the wage
	 * through `minimum_wage(region)`, so a region with no row refuses the run rather than guessing.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { Stack } from '@norbital-ai/ui/layout';

	import MatrixRenderer, { type MatrixColumn } from '../../../lib/ui/grid.svelte';
	import type { CollectionField } from '../../../lib/ui/grid.svelte';
	import { watch } from 'runed';
	import type { Wages } from '../../../lib/datatypes/wages.js';
	import { numberFrom } from '../../../lib/ui/renderer-input.js';
	import ExpressionField from '../../../lib/ui/expression-field.svelte';
	import type { CustomFieldView } from '@norbital-ai/ui';

	type WageRow = { id: string; region: string; amount: number };

	let { view }: { view: CustomFieldView<Wages> } = $props();
	const disabled = $derived(view.mode === 'edit' ? view.disabled : true);
	const readonly = $derived(view.mode !== 'edit');
	const wages = $derived(view.value);

	let rows = $state<WageRow[]>([]);
	watch(
		() => wages,
		(next) => {
			rows = Object.entries(next?.by_region ?? {}).map(([region, amount], index) => ({
				id: String(index),
				region,
				amount
			}));
		},
		{ lazy: false }
	);

	const columns: MatrixColumn<WageRow>[] = [
		{
			key: 'region',
			label: t('component.region'),
			field: { name: 'region', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'MY',
			width: 220
		},
		{
			key: 'amount',
			label: t('renderer.minimum_wage.amount'),
			field: { name: 'amount', kind: 'number', nullable: false } satisfies CollectionField,
			width: 180
		}
	];

	const appliesWhen = $derived(wages?.applies_when ?? '');

	function commit(next: WageRow[], applies = appliesWhen): void {
		rows = next;
		if (view.mode !== 'edit') return;
		// The keys this editor does not show (hourly table, scale, terms rule, authority) survive the edit.
		view.onChange({
			...wages,
			by_region: Object.fromEntries(
				next
					.filter((row) => row.region.trim() !== '')
					.map((row) => [row.region.trim(), numberFrom(String(row.amount), 0)])
			),
			applies_when: applies
		} satisfies Wages);
	}
</script>

<Stack gap="sm" class="w-full">
	<MatrixRenderer
		bind:rows
		{columns}
		{disabled}
		{readonly}
		allowAddRows={!disabled}
		getRowId={(row) => row.id}
		addRowLabel={t('renderer.minimum_wage.add_region')}
		createRow={() => ({ id: String(rows.length), region: '', amount: 0 })}
		onChange={commit}
	/>
	{#if rows.length === 0}
		<p class="text-meta">{t('renderer.minimum_wage.empty')}</p>
	{/if}
	<Stack gap="xs">
		<span class="text-sm font-semibold">{t('renderer.minimum_wage.applies_when')}</span>
		<p class="text-meta">{t('renderer.minimum_wage.applies_when_hint')}</p>
		<ExpressionField
			site="person"
			type="boolean"
			value={appliesWhen}
			mode={readonly ? 'display' : 'edit'}
			{disabled}
			empty={t('renderer.minimum_wage.applies_when_empty')}
			placeholder={'employment.type != "INTERN"'}
			onValueChange={(next) => commit(rows, next)}
		/>
	</Stack>
</Stack>
