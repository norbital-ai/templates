<script lang="ts">
	/**
	 * A stored code (or a list of codes) shown and picked by its row's name: the renderer of every custom field that
	 * names a version's row by code (a scheme, an allowance, a leave type, a holiday kind). A held code no option
	 * names stays listed under its code, so nothing a person did not choose is dropped.
	 */
	import { bolt } from '$bolt';
	import { Combobox } from '@norbital-ai/ui';

	type Option = { readonly value: string; readonly label: string };
	let {
		options,
		value,
		id,
		label,
		dense = false,
		disabled = false,
		edit,
		onChange
	}: {
		options: readonly Option[];
		value: string | readonly string[] | null;
		id?: string;
		label: string;
		dense?: boolean;
		disabled?: boolean;
		edit: boolean;
		onChange: (next: string | string[] | null) => void;
	} = $props();

	const held = $derived(value == null ? [] : typeof value === 'string' ? [value] : [...value]);
	const all = $derived([
		...options,
		...held
			.filter((code) => code !== '' && !options.some((option) => option.value === code))
			.map((code) => ({ value: code, label: code }))
	]);
	const labelOf = (code: string) => all.find((option) => option.value === code)?.label ?? code;
</script>

{#if edit && Array.isArray(value)}
	<Combobox
		{...id === undefined ? {} : { id }}
		aria-label={label}
		multiple
		options={all}
		value={held}
		{disabled}
		onChange={(next) => onChange([...next])}
	/>
{:else if edit}
	<Combobox
		{...id === undefined ? {} : { id }}
		aria-label={label}
		options={all}
		value={held[0] ?? null}
		clearable
		{disabled}
		onChange={(next) => onChange(next)}
	/>
{:else if held.length === 0}
	<span class="text-muted-foreground">—</span>
{:else}
	<span class={dense ? 'truncate' : undefined}>{held.map(labelOf).join(', ')}</span>
{/if}
