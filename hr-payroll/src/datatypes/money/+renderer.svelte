<script lang="ts">
	import { Result, Schema } from 'effect';
	import { formatDataValue } from '@norbital-ai/ui/data-renderer';
	import { MoneyRenderer } from '@norbital-ai/ui/data-renderer/money';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import type { RendererProps } from './$types.js';
	import { moneySchema } from './+definition.js';

	/**
	 * The platform hands every custom renderer the full `CollectionField` (name, kind, nullable,
	 * options, …); the generated `$types` only declare the `{ name, type }` minimum, so the field is
	 * restated against the design-system shape the callers and the runtime actually speak.
	 */
	type WithStdField<P> = P extends unknown
		? Omit<P, 'field'> & { readonly field: CollectionField }
		: never;
	type MoneyRendererProps = WithStdField<RendererProps>;
	let props: MoneyRendererProps = $props();

	/**
	 * `MoneyRenderer` types its callback as `(value: unknown) => void`. Validate at that boundary
	 * rather than widening our own prop, so an unparseable value never reaches the column.
	 */
	function emit(next: unknown): void {
		if (props.mode !== 'edit') return;
		if (next == null) {
			props.onValueChange(null);
			return;
		}
		const parsed = Schema.decodeUnknownResult(moneySchema())(next);
		if (Result.isSuccess(parsed)) props.onValueChange(parsed.success);
	}

	const allowedCurrencies = $derived.by((): readonly string[] | undefined => {
		const candidate = props.field.options?.allowedCurrencies;
		return Array.isArray(candidate) && candidate.every((currency) => typeof currency === 'string')
			? candidate
			: undefined;
	});
	const field = $derived({
		...props.field,
		currencies: allowedCurrencies
	} satisfies CollectionField);
</script>

{#if props.mode === 'edit'}
	<MoneyRenderer
		{field}
		value={props.value}
		mode="edit"
		disabled={props.disabled}
		onValueChange={(next: unknown) => emit(next)}
	/>
{:else}
	<span class="block truncate" title={formatDataValue(field, props.value)}>
		{formatDataValue(field, props.value)}
	</span>
{/if}
