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

	type Band = { readonly id: string; readonly eligibility: string; readonly days: number };

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	/** Read top-down: the most specific tier first, the everyone row last. */
	const BAND_COLUMNS = [
		{
			key: 'eligibility',
			label: t('component.who_receives'),
			field: { name: 'eligibility', kind: 'text', nullable: false } satisfies CollectionField,
			placeholder: 'employment.service_months >= 24',
			width: 320
		},
		{
			key: 'days',
			label: t('component.days'),
			field: { name: 'days', kind: 'numeric', nullable: false } satisfies CollectionField,
			width: 120
		}
	] satisfies readonly MatrixColumn<Band>[];
	const disabled = $derived(props.mode !== 'edit' || props.disabled);
	const current = $derived<LeaveEntitlement>(
		props.value ?? {
			availability: 'UPFRONT',
			year_start_month: 1,
			proration: 'CALENDAR_MONTHS',
			bands: []
		}
	);
	const availabilityOptions = $derived(
		(['UPFRONT', 'MONTHLY', 'UNLIMITED'] as const).map((value) => ({
			value,
			label: t(`leave.availability.${value}`)
		}))
	);
	const prorationOptions = $derived(
		(['NONE', 'CALENDAR_MONTHS', 'COMPLETED_MONTHS', 'CALENDAR_DAYS'] as const)
			.filter((value) => current.availability !== 'MONTHLY' || value !== 'NONE')
			.map((value) => ({ value, label: t(`leave.proration.${value}`) }))
	);
	const rows = $derived<Band[]>(
		current.bands.map((band, index) => ({ id: `band-${index}`, ...band }))
	);
	const summary = $derived(
		props.value == null
			? '—'
			: t('leave.entitlement_summary', {
					availability: t(`leave.availability.${current.availability}`),
					count: current.bands.length
				})
	);
	function emit(next: LeaveEntitlement): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#if props.mode === 'display'}
	<span class="block truncate" title={summary}>{summary}</span>
{:else}
	<Stack gap="sm">
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
							if (availability)
								emit({
									...current,
									availability,
									proration:
										availability === 'MONTHLY' && current.proration === 'NONE'
											? 'CALENDAR_MONTHS'
											: current.proration
								});
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
			{/if}
		</Grid>
		{#if current.availability !== 'UNLIMITED'}
			<p class="text-meta">{t('renderer.leave_entitlement.identity')}</p>
			<MatrixRenderer
				{rows}
				columns={BAND_COLUMNS}
				{disabled}
				emptyMessage={t('renderer.leave_entitlement.empty')}
				addRowLabel={t('leave.add_band')}
				createRow={(): Band => ({ id: crypto.randomUUID(), eligibility: '', days: 0 })}
				bounded={false}
				onChange={(next) =>
					emit({
						...current,
						bands: next.map(({ eligibility, days }) => ({ eligibility, days: Number(days) || 0 }))
					})}
			/>
		{/if}
	</Stack>
{/if}
