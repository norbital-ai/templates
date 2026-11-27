<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { format, MoneyInput, watch_pre, type Value } from '@norbital-ai/ui';
	import { displayUnit, isKgUnit, priceToDisplay, priceToStorage } from '../unit-display.js';

	let {
		ctx,
		value,
		unit,
		currency,
		on_change,
		id,
		readonly = false,
		disabled = false,
		invalid = false,
		dense = false
	}: {
		ctx: PageContext;
		value: Value;
		unit: string | null | undefined;
		currency?: string;
		on_change?: (next: Value) => void;
		id?: string;
		readonly?: boolean;
		disabled?: boolean;
		invalid?: boolean;
		dense?: boolean;
	} = $props();

	const kg = $derived(isKgUnit(unit));
	const shownUnit = $derived(displayUnit(unit, ctx.locale));
	const asText = (v: Value) => (v === null || v === undefined ? null : String(v));

	let displayValue = $state<Value>(null);
	let lastStorage: string | null | undefined;
	let lastUnit: string | null | undefined;

	watch_pre(
		() => [asText(value), unit] as const,
		([stored, currentUnit]) => {
			if (stored !== lastStorage || currentUnit !== lastUnit) {
				displayValue = priceToDisplay(stored, currentUnit);
				lastStorage = stored;
				lastUnit = currentUnit;
			}
		}
	);

	function handleChange(next: Value) {
		displayValue = next;
		const stored = next === null ? null : priceToStorage(String(next), unit);
		lastStorage = stored;
		lastUnit = unit;
		on_change?.(stored);
	}

	const formattedReadonly = $derived.by(() => {
		const shown = priceToDisplay(asText(value), unit);
		if (shown === null) return '—';
		const money = format({ kind: 'money' }, shown, {
			locale: ctx.locale,
			...(currency === undefined ? {} : { currency })
		});
		return !dense && shownUnit ? `${money} / ${shownUnit}` : money;
	});
</script>

{#if readonly}
	<span {id} class="tabular-nums">{formattedReadonly}</span>
{:else}
	<div class="flex items-center gap-1.5">
		<div class="min-w-0 flex-1">
			<MoneyInput
				{ctx}
				{...id ? { id } : {}}
				value={displayValue}
				on_change={handleChange}
				{...currency ? { currency } : {}}
				scale={kg ? 1 : 4}
				{disabled}
				{invalid}
			/>
		</div>
		{#if !dense && shownUnit}
			<span class="shrink-0 text-xs font-medium text-muted-foreground">/ {shownUnit}</span>
		{/if}
	</div>
{/if}
