<script lang="ts">
	/**
	 * The contract's agreed allowances: one row per catalog item of this contract's law, its amount, and a
	 * remove. The catalog row owns the allowance; the contract states only how
	 * much.
	 */
	import {
		Button,
		Combobox,
		Input,
		type FieldEditor,
		type Value,
		value_object
	} from '@norbital-ai/ui';
	import { Inline, Stack } from '@norbital-ai/ui/layout';
	import type { Law } from '../../law.js';
	import { isJsonObject } from '../../payroll_engine/foundation.js';

	let { field, law }: { field: FieldEditor; law: Law | undefined } = $props();
	// a catalogue row whose conversion reads the agreed amount is stated on the contract; a formula row computes itself
	const choices = $derived(
		(law?.rows.allowance_catalog ?? [])
			.filter((row) => /allowances\.[A-Z0-9_]+/.test(String(row.conversion ?? '')))
			.map((row) => ({
				value:
					isJsonObject(row.lookup) && typeof row.lookup.allowance === 'string'
						? row.lookup.allowance
						: String(row.code),
				label: String(row.code),
				description: String(row.code)
			}))
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
