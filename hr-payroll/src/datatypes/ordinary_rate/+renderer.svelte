<script lang="ts">
	import { Result, Schema } from 'effect';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { ordinaryRateSchema } from './+definition.js';
	import type { RendererProps, Value } from './$types.js';

	const { t } = useI18n<TenantI18nKeys>();

	type Per = Value['per'];
	const PER_OPTIONS: { value: Per; label: string; description: string }[] = [
		{ value: 'DAY', label: 'Per day', description: 'Monthly wage ÷ divisor is one day of pay' },
		{ value: 'HOUR', label: 'Per hour', description: 'Monthly wage ÷ divisor is one hour of pay' }
	];

	let props: RendererProps = $props();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const parsed = $derived(
		Schema.decodeUnknownResult(ordinaryRateSchema)(props.value, { onExcessProperty: 'error' })
	);
	const current = $derived(Result.isSuccess(parsed) ? parsed.success : null);
	const summary = $derived(
		current === null
			? '—'
			: t('renderer.ordinary_rate.summary', {
					divisor: String(current.divisor),
					unit: current.per === 'HOUR' ? t('component.hours_unit') : t('component.days_unit')
				})
	);

	function emit(next: Value | null): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Grid class="rounded-md border border-border bg-muted/20 p-3" gap="sm" minimum="compact">
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('renderer.ordinary_rate.per')}
				<Combobox
					options={PER_OPTIONS}
					value={current?.per ?? null}
					{disabled}
					searchable={false}
					emptyPlaceholder={t('renderer.ordinary_rate.select_per')}
					onValueChange={(per) => {
						if (per === null) emit(null);
						else emit({ per, divisor: current?.divisor ?? 26 });
					}}
				/>
			</Stack>
		</label>
		<label class="text-sm font-medium">
			<Stack gap="xs">
				{t('renderer.ordinary_rate.divisor')}
				<Input
					type="number"
					step="any"
					value={current?.divisor ?? ''}
					disabled={disabled || current === null}
					oninput={(event) => {
						const divisor = Number(event.currentTarget.value);
						if (current !== null && Number.isFinite(divisor)) emit({ ...current, divisor });
					}}
				/>
			</Stack>
		</label>
	</Grid>
{/if}
