<script lang="ts">
	/**
	 * The contract's agreed allowances: one row per catalog item of this contract's settings version, its amount, and a
	 * remove. The catalog row owns the allowance; the contract states only how
	 * much.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Button,
		Combobox,
		Input,
		type FieldEditor,
		type Value,
		value_object
	} from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import { idOf } from '../../payroll_engine/reads.js';

	let {
		ctx,
		field,
		versionId
	}: { ctx: PageContext; field: FieldEditor; versionId: string | undefined } = $props();
	const catalog = $derived(
		typeof versionId === 'string'
			? ctx.query({
					allowance_catalog: {
						where: { settings_id: { eq: idOf('jurisdiction_settings', versionId) } },
						fields: ['code', 'lookup', 'conversion'],
						limit: 1000
					}
				})
			: null
	);
	// a catalogue row whose conversion reads the agreed amount is stated on the contract; a formula row computes itself
	const choices = $derived(
		(catalog?.current?.allowance_catalog.rows ?? [])
			.filter((row) => /allowances\.[A-Z0-9_]+/.test(String(row.conversion ?? '')))
			.map((row) => {
				const lookup = value_object(row.lookup) ? row.lookup : {};
				return {
					value: typeof lookup.allowance === 'string' ? lookup.allowance : row.code,
					label: row.code,
					description: row.code
				};
			})
	);
	const entries = $derived(
		Object.entries(value_object(field.value) ? field.value : {}) as [string, Value][]
	);
	const amountOf = (value: Value): number =>
		value_object(value) && typeof value.amount === 'number' ? value.amount : 0;
	const record = (rows: readonly (readonly [string, Value])[]) =>
		Object.fromEntries(rows) as Record<string, Value>;
	const set = (code: string, next: Value) =>
		field.on_change(record(entries.map(([key, value]) => [key, key === code ? next : value])));
	const rename = (from: string, to: string) => {
		if (to === from || entries.some(([key]) => key === to)) return;
		field.on_change(record(entries.map(([key, value]) => [key === from ? to : key, value])));
	};
	const remove = (code: string) => field.on_change(record(entries.filter(([key]) => key !== code)));
	const add = (code: string | null) => {
		if (code === null) return;
		field.on_change(record([...entries, [code, { amount: 0 }]]));
	};
	const unused = $derived(
		choices.filter((choice) => !entries.some(([key]) => key === choice.value))
	);
</script>

<Stack gap="sm">
	{#each entries as [code, value], index (code)}
		<Inline gap="sm" class="items-center">
			<Combobox
				id={`${field.id}-${index}`}
				disabled={field.disabled}
				value={code}
				options={choices}
				display={code}
				on_change={(next) => next !== null && rename(code, next)}
			/>
			<Input
				type="number"
				min="0"
				disabled={field.disabled}
				value={amountOf(value)}
				aria-label={code}
				oninput={(event) => set(code, { amount: Number(event.currentTarget.value) })}
			/>
			<Button
				variant="ghost"
				size="icon"
				disabled={field.disabled}
				aria-label={`Remove ${code}`}
				onclick={() => remove(code)}
			>
				×
			</Button>
		</Inline>
	{/each}
	{#if !field.disabled}
		<Combobox
			id={`${field.id}-add`}
			value={null}
			options={unused}
			placeholder="Add allowance"
			searchable
			on_change={add}
		/>
	{/if}
</Stack>
