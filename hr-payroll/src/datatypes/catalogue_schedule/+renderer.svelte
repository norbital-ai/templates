<script lang="ts">
	/**
	 * The calendar a scheduled catalogue row falls due on: every year on a month and
	 * day, or every month on a day; who is owed it that day; the qualifying service; and whether a
	 * leaver is owed the year's occurrence on separation.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import ExpressionField from '../../lib/ui/expression-field.svelte';
	import { DEFAULT_SCHEDULE, type CatalogueSchedule } from './+definition.js';
	import type { RendererProps } from './$types.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const readonly = $derived(props.mode !== 'edit');
	const current = $derived((props.value ?? DEFAULT_SCHEDULE) as CatalogueSchedule);

	function emit(next: Partial<CatalogueSchedule>): void {
		if (props.mode === 'edit') props.onValueChange({ ...current, ...next });
	}
	const number = (value: string, fallback: number) => {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
	};
</script>

{#if readonly}
	<span class="text-sm">
		{current.every === 'YEAR'
			? t('renderer.catalogue_schedule.summary_year', {
					month: String(current.month ?? ''),
					day: String(current.day)
				})
			: current.every === 'MONTH'
				? t('renderer.catalogue_schedule.summary_month', { day: String(current.day) })
				: t('renderer.catalogue_schedule.summary_separation')}
		{#if current.from_service_months > 0}
			· {t('renderer.catalogue_schedule.after_service', {
				months: String(current.from_service_months)
			})}
		{/if}
		{#if current.on_separation && current.every === 'YEAR'}
			· {t('renderer.catalogue_schedule.on_separation')}
		{/if}
		{#if current.when.trim() !== ''}
			· <code class="font-mono text-xs">{current.when}</code>
		{/if}
	</span>
{:else}
	<Stack gap="sm">
		<Grid gap="sm" minimum="compact">
			<label class="flex flex-col gap-1 text-sm">
				<span>{t('renderer.catalogue_schedule.every')}</span>
				<select
					class="rounded border px-2 py-1"
					{disabled}
					value={current.every}
					onchange={(event) =>
						emit({
							every: (event.currentTarget as HTMLSelectElement).value as CatalogueSchedule['every']
						})}
				>
					<option value="YEAR">{t('renderer.catalogue_schedule.every_year')}</option>
					<option value="MONTH">{t('renderer.catalogue_schedule.every_month')}</option>
					<option value="SEPARATION">{t('renderer.catalogue_schedule.every_separation')}</option>
				</select>
			</label>
			{#if current.every === 'YEAR'}
				<label class="flex flex-col gap-1 text-sm">
					<span>{t('renderer.catalogue_schedule.month')}</span>
					<input
						class="rounded border px-2 py-1"
						type="number"
						min="1"
						max="12"
						{disabled}
						value={current.month ?? 12}
						onchange={(event) =>
							emit({ month: number((event.currentTarget as HTMLInputElement).value, 12) })}
					/>
				</label>
			{/if}
			{#if current.every !== 'SEPARATION'}
				<label class="flex flex-col gap-1 text-sm">
					<span>{t('renderer.catalogue_schedule.day')}</span>
					<input
						class="rounded border px-2 py-1"
						type="number"
						min="1"
						max="31"
						{disabled}
						value={current.day}
						onchange={(event) =>
							emit({ day: number((event.currentTarget as HTMLInputElement).value, 1) })}
					/>
				</label>
			{/if}
			<label class="flex flex-col gap-1 text-sm">
				<span>{t('renderer.catalogue_schedule.from_service_months')}</span>
				<input
					class="rounded border px-2 py-1"
					type="number"
					min="0"
					{disabled}
					value={current.from_service_months}
					onchange={(event) =>
						emit({
							from_service_months: number((event.currentTarget as HTMLInputElement).value, 0)
						})}
				/>
			</label>
			{#if current.every === 'YEAR'}
				<label class="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						{disabled}
						checked={current.on_separation}
						onchange={(event) =>
							emit({ on_separation: (event.currentTarget as HTMLInputElement).checked })}
					/>
					<span>{t('renderer.catalogue_schedule.on_separation')}</span>
				</label>
			{/if}
		</Grid>
		<Stack gap="xs">
			<span class="text-sm font-semibold">{t('renderer.catalogue_schedule.when')}</span>
			<ExpressionField
				site="person"
				type="boolean"
				value={current.when}
				mode="edit"
				{disabled}
				empty={t('renderer.catalogue_schedule.when_empty')}
				placeholder={'employment.classification != "MANAGERIAL"'}
				onValueChange={(next) => emit({ when: next })}
			/>
		</Stack>
	</Stack>
{/if}
