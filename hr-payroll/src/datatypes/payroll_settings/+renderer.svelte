<script lang="ts">
	/**
	 * The payroll facts of one settings version: currency, the IANA zone its wall
	 * clock sits at, and the month its tax year opens. Machine facts, not prose: each is a real
	 * field here so the drift automation and the engine read the same value the operator typed.
	 * One compact row, three columns.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import TimezonePicker from '../../collections/jurisdiction_settings/TimezonePicker.svelte';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps, Value } from './$types.js';

	let props: RendererProps = $props();
	const i18n = useI18n<TenantI18nKeys>();
	const { t } = i18n;
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const current = $derived<Value | null>(props.value ?? null);
	const monthName = (month: number): string =>
		new Intl.DateTimeFormat(i18n.intlLocale, { month: 'long' }).format(
			new Date(2000, Math.min(Math.max(month, 1), 12) - 1, 1)
		);

	function emit(next: Value): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<Grid gap="sm" minimum="compact" class="w-full">
		<div class="flex flex-col gap-0.5 text-xs">
			<span class="text-muted-foreground">{t('component.currency')}</span>
			<span class="text-sm">{current?.currency ?? '—'}</span>
		</div>
		<div class="flex flex-col gap-0.5 text-xs">
			<span class="text-muted-foreground">{t('component.timezone')}</span>
			<span class="text-sm">{current?.timezone ?? '—'}</span>
		</div>
		<div class="flex flex-col gap-0.5 text-xs">
			<span class="text-muted-foreground">{t('component.tax_year_start_month')}</span>
			<span class="text-sm">
				{current == null ? '—' : monthName(current.tax_year_start_month)}
			</span>
		</div>
	</Grid>
{:else if current != null}
	<Grid gap="sm" minimum="compact" class="w-full">
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.currency')}</span>
				<Input
					class="h-8"
					value={current.currency}
					maxlength={3}
					{disabled}
					oninput={(event) =>
						emit({ ...current, currency: event.currentTarget.value.toUpperCase() })}
				/>
			</Stack>
		</label>
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.timezone')}</span>
				<TimezonePicker
					value={current.timezone}
					onValueChange={(timezone) => {
						if (typeof timezone === 'string') emit({ ...current, timezone });
					}}
				/>
			</Stack>
		</label>
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.tax_year_start_month')}</span>
				<Input
					class="h-8"
					type="number"
					min="1"
					max="12"
					step="1"
					value={current.tax_year_start_month}
					{disabled}
					oninput={(event) =>
						emit({
							...current,
							tax_year_start_month: numberFrom(event.currentTarget.value, 1)
						})}
				/>
			</Stack>
		</label>
	</Grid>
{/if}
