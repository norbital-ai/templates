<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid } from '@norbital-ai/ui/layout';
	import { accrualKeySchema } from './+definition.js';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import type { RendererProps, Value } from './$types.js';
	const { t } = useI18n<TenantI18nKeys>();

	type KeyBy = Value['by'];

	const KEY_OPTIONS: { value: KeyBy; label: string; description: string }[] = [
		{
			value: 'SERVICE_MONTHS',
			label: 'Service months',
			description: 'Band applies from N completed months of service'
		},
		{ value: 'FLAT', label: 'Flat', description: 'Same entitlement for everyone' }
	];

	/**
	 * The platform hands every custom renderer the full `CollectionField` (name, kind, nullable,
	 * options, …); the generated `$types` only declare the `{ name, type }` minimum, so the field is
	 * restated against the design-system shape the callers and the runtime actually speak.
	 */
	type WithStdField<P> = P extends unknown
		? Omit<P, 'field'> & { readonly field: CollectionField }
		: never;
	type Props = WithStdField<RendererProps>;
	let props: Props = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(accrualKeySchema)(props.value, { onExcessProperty: 'error' })
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived.by(() => {
		if (current === null) return '—';
		return current.by === 'SERVICE_MONTHS' ? `From ${current.band_from} months` : 'Flat';
	});

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}

	function defaultFor(by: KeyBy): Value {
		switch (by) {
			case 'SERVICE_MONTHS':
				return { by: 'SERVICE_MONTHS', band_from: 0 };
			case 'FLAT':
				return { by: 'FLAT' };
		}
	}

	function selectKey(by: KeyBy | null): void {
		if (by === null) {
			emit(null);
			return;
		}
		if (current !== null && current.by === by) return;
		emit(defaultFor(by));
	}

	function numberFrom(raw: string, fallback: number): number {
		const next = Number(raw);
		return Number.isFinite(next) ? next : fallback;
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="grid gap-1.5 text-sm font-medium">
			Keyed by
			<Combobox
				options={KEY_OPTIONS}
				value={current?.by ?? null}
				{disabled}
				searchable={false}
				emptyPlaceholder={t('renderer.accrual_key.select_key')}
				onValueChange={selectKey}
			/>
		</label>
		{#if current?.by === 'SERVICE_MONTHS'}
			<label class="grid gap-1.5 text-sm font-medium">
				Band from (completed months)
				<Input
					type="number"
					min="0"
					step="1"
					value={current.band_from}
					{disabled}
					oninput={(event) =>
						emit({ by: 'SERVICE_MONTHS', band_from: numberFrom(event.currentTarget.value, 0) })}
				/>
			</label>
		{/if}
	</Grid>
{/if}
