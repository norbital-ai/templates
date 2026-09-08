<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Stack } from '@norbital-ai/ui/layout';
	import { numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';
	import type { LeaveEntitlement } from './+definition.js';

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
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
			{#each current.bands as band, index (index)}
				<Grid gap="sm" minimum="compact">
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('renderer.leave_entitlement.band_from')}
							<Input
								type="number"
								min="0"
								step="1"
								value={band.band_from}
								{disabled}
								oninput={(event) =>
									emit({
										...current,
										bands: current.bands.map((row, i) =>
											i === index
												? { ...row, band_from: numberFrom(event.currentTarget.value, 0) }
												: row
										)
									})}
							/>
						</Stack></label
					>
					<label class="text-sm font-medium"
						><Stack gap="xs">
							{t('component.days')}
							<Input
								type="number"
								min="0"
								step="0.5"
								value={band.days}
								{disabled}
								oninput={(event) =>
									emit({
										...current,
										bands: current.bands.map((row, i) =>
											i === index ? { ...row, days: numberFrom(event.currentTarget.value, 0) } : row
										)
									})}
							/>
						</Stack></label
					>
					<Cluster align="end"
						><Button
							variant="ghost"
							size="sm"
							{disabled}
							onclick={() =>
								emit({ ...current, bands: current.bands.filter((_, i) => i !== index) })}
						>
							{t('leave.remove_band')}
						</Button></Cluster
					>
				</Grid>
			{/each}
			<Cluster
				><Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() =>
						emit({
							...current,
							bands: [
								...current.bands,
								{
									band_from:
										current.bands.length === 0
											? 0
											: Math.max(...current.bands.map((row) => row.band_from)) + 12,
									days: 0
								}
							]
						})}
				>
					{t('leave.add_band')}
				</Button></Cluster
			>
		{/if}
	</Stack>
{/if}
