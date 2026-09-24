<script lang="ts">
	/**
	 * The payroll facts of one settings version: currency, the IANA zone its wall clock sits at,
	 * the month its tax year opens and whether unpaid leave prorates a standing allowance. Machine
	 * facts, not prose: each is a real field here so the drift automation and the engine read the
	 * same value the operator typed. One compact row, four columns.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import { timezoneNames } from '../../lib/timezone.js';
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

	/**
	 * The jurisdiction's wall clock, chosen by name. A free integer cannot express a zone that
	 * observes daylight saving; the engine derives the offset from the name for the date it prices.
	 */
	const timezoneOptions = timezoneNames().map((zone) => ({ value: zone, label: zone }));

	function emit(next: Value): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<Grid gap="sm" minimum="compact" class="w-full">
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.currency')}</span>
			<span class="text-sm">{current?.currency ?? '—'}</span>
		</Stack>
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.timezone')}</span>
			<span class="text-sm">{current?.timezone ?? '—'}</span>
		</Stack>
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.tax_year_start_month')}</span>
			<span class="text-sm">
				{current == null ? '—' : monthName(current.tax_year_start_month)}
			</span>
		</Stack>
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.allowance_npl_prorates')}</span>
			<span class="text-sm">
				{current == null ? '—' : current.allowance_npl_prorates ? t('common.yes') : t('common.no')}
			</span>
		</Stack>
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.final_pay_due_days')}</span>
			<span class="text-sm">{current?.final_pay_due_days ?? '—'}</span>
		</Stack>
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.holiday_in_npl_unpaid')}</span>
			<span class="text-sm"
				>{current?.holiday_in_no_pay_leave_unpaid ? t('common.yes') : t('common.no')}</span
			>
		</Stack>
		<Stack gap="xs" class="text-xs">
			<span class="text-muted-foreground">{t('component.short_day_half_hours')}</span>
			<span class="text-sm">{current?.short_day_half_hours ?? '—'}</span>
		</Stack>
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
				<div data-timezone-picker>
					<Combobox
						options={timezoneOptions}
						value={current.timezone.length > 0 ? current.timezone : null}
						onValueChange={(timezone) => {
							if (typeof timezone === 'string') emit({ ...current, timezone });
						}}
						allowClear={false}
						ariaLabel={t('component.timezone')}
						searchPlaceholder={t('component.search_timezones')}
						emptyPlaceholder={t('component.choose_timezone')}
					/>
				</div>
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
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.allowance_npl_prorates')}</span>
				<input
					type="checkbox"
					class="h-4 w-4"
					checked={current.allowance_npl_prorates}
					{disabled}
					onchange={(event) =>
						emit({ ...current, allowance_npl_prorates: event.currentTarget.checked })}
				/>
			</Stack>
		</label>
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.final_pay_due_days')}</span>
				<Input
					class="h-8"
					type="number"
					min="1"
					step="1"
					value={current.final_pay_due_days ?? ''}
					{disabled}
					oninput={(event) =>
						emit({
							...current,
							final_pay_due_days:
								event.currentTarget.value.trim() === ''
									? null
									: Math.max(1, Math.trunc(Number(event.currentTarget.value)) || 1)
						})}
				/>
			</Stack>
		</label>
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.holiday_in_npl_unpaid')}</span>
				<input
					type="checkbox"
					class="h-4 w-4"
					checked={current.holiday_in_no_pay_leave_unpaid ?? false}
					{disabled}
					onchange={(event) =>
						emit({ ...current, holiday_in_no_pay_leave_unpaid: event.currentTarget.checked })}
				/>
			</Stack>
		</label>
		<label class="text-xs">
			<Stack gap="xs">
				<span class="text-muted-foreground">{t('component.short_day_half_hours')}</span>
				<input
					type="number"
					class="border-input bg-background h-8 rounded-md border px-2"
					min="0"
					step="0.5"
					value={current.short_day_half_hours ?? ''}
					{disabled}
					onchange={(event) =>
						emit({
							...current,
							short_day_half_hours:
								event.currentTarget.value.trim() === '' ? null : Number(event.currentTarget.value)
						})}
				/>
			</Stack>
		</label>
	</Grid>
{/if}
