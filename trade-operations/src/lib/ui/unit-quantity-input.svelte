<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { format, Input, watch_pre, type Value } from '@norbital-ai/ui';
	import { displayUnit, isKgUnit, qtyToDisplay, qtyToStorage } from '../unit-display.js';

	let {
		ctx,
		value,
		unit,
		on_change,
		id,
		readonly = false,
		disabled = false,
		invalid = false,
		dense = false,
		aria_label
	}: {
		ctx: PageContext;
		value: Value;
		unit: string | null | undefined;
		on_change?: (next: Value) => void;
		id?: string;
		readonly?: boolean;
		disabled?: boolean;
		invalid?: boolean;
		dense?: boolean;
		aria_label?: string;
	} = $props();

	const kg = $derived(isKgUnit(unit));
	const shownUnit = $derived(displayUnit(unit, ctx.locale));
	const maxDecimals = $derived(kg ? 6 : 3);
	const asText = (v: Value) => (v === null || v === undefined ? null : String(v));

	let text = $state('');
	let lastStorage: string | null | undefined;
	let lastUnit: string | null | undefined;

	watch_pre(
		() => [asText(value), unit] as const,
		([stored, currentUnit]) => {
			if (stored !== lastStorage || currentUnit !== lastUnit) {
				text = qtyToDisplay(stored, currentUnit) ?? '';
				lastStorage = stored;
				lastUnit = currentUnit;
			}
		}
	);

	function handleInput(raw: string) {
		const clean = raw.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
		const [whole, fraction] = clean.split('.');
		text = fraction === undefined ? clean : `${whole ?? ''}.${fraction.slice(0, maxDecimals)}`;
		if (text === '') {
			lastStorage = null;
			lastUnit = unit;
			on_change?.(null);
			return;
		}
		if (/^\d+(\.\d+)?$/.test(text)) {
			const stored = qtyToStorage(text, unit);
			if (stored !== null) {
				lastStorage = stored;
				lastUnit = unit;
				on_change?.(stored);
			}
		}
	}

	const formattedReadonly = $derived.by(() => {
		const shown = qtyToDisplay(asText(value), unit);
		if (shown === null) return '—';
		const frac = shown.includes('.') ? Math.min(6, shown.split('.')[1]?.length ?? 0) : 0;
		const num = format({ kind: 'decimal', scale: frac }, shown, { locale: ctx.locale });
		return !dense && shownUnit ? `${num} ${shownUnit}` : num;
	});
</script>

{#if readonly}
	<span {id} class="tabular-nums">{formattedReadonly}</span>
{:else}
	<div class="flex items-center gap-1.5">
		<Input
			{id}
			type="text"
			inputmode="decimal"
			autocomplete="off"
			aria-label={aria_label}
			aria-invalid={invalid ? 'true' : undefined}
			class="min-w-0 flex-1 text-right tabular-nums"
			value={text}
			{disabled}
			oninput={(event) => handleInput(event.currentTarget.value)}
		/>
		{#if !dense && shownUnit}
			<span class="shrink-0 text-xs font-medium text-muted-foreground">{shownUnit}</span>
		{/if}
	</div>
{/if}
