<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { CollectionField } from '@norbital-ai/ui/data-renderer';
	import { MatrixRenderer, type MatrixColumn } from '@norbital-ai/ui/data-renderer/matrix';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';
	import type { LeaveEntitlement } from './+definition.js';

	type Band = { readonly id: string; readonly eligibility: string; readonly days: number | string };

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	/** Read top-down: the most specific tier first, the everyone row last. */
	const BAND_COLUMNS = [
		{
			key: 'eligibility',
			label: t('component.who_receives'),
			field: { name: 'eligibility', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'employment.service_months >= 24',
			width: 340
		},
		{
			key: 'days',
			label: t('component.days'),
			// A figure, or a number over the person (`12.0 + floor_unit(employment.service_months / 60.0)`).
			field: { name: 'days', kind: 'text', nullable: false } satisfies CollectionField,
			width: 220
		}
	] satisfies readonly MatrixColumn<Band>[];
	const disabled = $derived(props.mode !== 'edit' || props.disabled);
	const readonly = $derived(props.mode !== 'edit');
	const current = $derived<LeaveEntitlement>(
		props.value ?? {
			availability: 'UPFRONT',
			year_start_month: 1,
			proration: 'CALENDAR_MONTHS',
			bands: []
		}
	);
	const availabilityOptions = $derived(
		(['UPFRONT', 'MONTHLY', 'UNLIMITED', 'PER_EVENT', 'CREDITED'] as const).map((value) => ({
			value,
			label: t(`leave.availability.${value}`)
		}))
	);
	const roundingOptions = $derived(
		(['HALF_DAY', 'WHOLE_DAY'] as const).map((value) => ({
			value,
			label: t(`leave.rounding.${value}`)
		}))
	);
	/** A blank count clears the field; anything else is the integer typed. */
	const countFrom = (text: string): number | null =>
		text.trim() === '' ? null : Math.max(1, Math.trunc(numberFrom(text, 1)));
	const prorationOptions = $derived(
		(['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'HALF_MONTHS', 'CALENDAR_DAYS'] as const).map(
			(value) => ({
				value,
				label: t(`leave.proration.${value}`)
			})
		)
	);
	const rows = $derived<Band[]>(
		current.bands.map((band, index) => ({ id: `band-${index}`, ...band }))
	);
	function emit(next: LeaveEntitlement): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

<Stack gap="sm" class="w-full">
	<Grid gap="sm" minimum="compact">
		<label class="text-sm font-medium"
			><Stack gap="xs">
				{t('leave.availability')}
				<Combobox
					options={availabilityOptions}
					value={current.availability}
					{disabled}
					searchable={false}
					onValueChange={(availability) => {
						if (availability) emit({ ...current, availability });
					}}
				/>
			</Stack></label
		>
		<label class="text-sm font-medium"
			><Stack gap="xs">
				{t('leave.year_start_month')}
				<Input
					type="number"
					min="1"
					max="12"
					step="1"
					value={current.year_start_month}
					{disabled}
					oninput={(event) =>
						emit({ ...current, year_start_month: numberFrom(event.currentTarget.value, 1) })}
				/>
			</Stack></label
		>
		{#if current.availability !== 'UNLIMITED'}
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('leave.proration')}
					<Combobox
						options={prorationOptions}
						value={current.proration}
						{disabled}
						searchable={false}
						onValueChange={(proration) => {
							if (proration) emit({ ...current, proration });
						}}
					/>
				</Stack></label
			>
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('leave.rounding')}
					<Combobox
						options={roundingOptions}
						value={current.rounding ?? 'HALF_DAY'}
						{disabled}
						searchable={false}
						onValueChange={(rounding) => {
							if (rounding) emit({ ...current, rounding });
						}}
					/>
				</Stack></label
			>
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('leave.rolling_months')}
					<Input
						type="number"
						min="1"
						step="1"
						value={current.rolling_months ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, rolling_months: countFrom(event.currentTarget.value) })}
					/>
				</Stack></label
			>
		{/if}
		<label class="text-sm font-medium"
			><Stack gap="xs">
				{t('leave.lifetime_days')}
				<Input
					value={current.lifetime_days == null ? '' : String(current.lifetime_days)}
					{disabled}
					oninput={(event) => {
						const text = event.currentTarget.value.trim();
						emit({
							...current,
							lifetime_days:
								text === ''
									? null
									: Number.isFinite(Number(text)) && Number(text) > 0
										? Number(text)
										: text
						});
					}}
				/>
			</Stack></label
		>
		<label class="text-sm font-medium"
			><Stack gap="xs">
				{t('leave.consumes_after_days')}
				<Input
					type="number"
					min="0"
					step="0.5"
					value={current.consumes_after_days ?? ''}
					{disabled}
					oninput={(event) =>
						emit({
							...current,
							consumes_after_days:
								event.currentTarget.value.trim() === ''
									? null
									: Math.max(0, Number(event.currentTarget.value) || 0)
						})}
				/>
			</Stack></label
		>
		{#if current.availability === 'PER_EVENT'}
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('leave.lifetime_events')}
					<Input
						type="number"
						min="1"
						step="1"
						value={current.lifetime_events ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, lifetime_events: countFrom(event.currentTarget.value) })}
					/>
				</Stack></label
			>
		{/if}
	</Grid>
	{#if current.availability !== 'UNLIMITED'}
		<p class="text-meta">{t('renderer.leave_entitlement.identity')}</p>
		<MatrixRenderer
			class="w-full"
			{rows}
			columns={BAND_COLUMNS}
			{disabled}
			{readonly}
			allowAddRows={!disabled}
			emptyMessage={t('renderer.leave_entitlement.empty')}
			addRowLabel={t('leave.add_band')}
			createRow={(): Band => ({ id: crypto.randomUUID(), eligibility: '', days: 0 })}
			bounded={false}
			onChange={(next) =>
				emit({
					...current,
					bands: next.map(({ eligibility, days }) => ({
						eligibility,
						days:
							String(days).trim() === ''
								? 0
								: Number.isFinite(Number(days))
									? Number(days)
									: String(days)
					}))
				})}
		/>
	{/if}
</Stack>
