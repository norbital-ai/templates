<script lang="ts">
	/**
	 * The arithmetic around one statutory scheme's bands (RFC 0001 §8): relief, base transform and
	 * dependant share as CEL over the scheme context, with the typed remainder — rounding chain,
	 * withholding floor, period-table flag, additional-remuneration channel and the relief caps.
	 *
	 * An empty expression is a real answer meaning "nothing changes", so blank is never refused
	 * here; a non-blank one is compiled live and the Fields panel lists what it may read.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { Schema } from 'effect';
	import type { RoundingMethod } from '../../collections/payroll_runs/lib/rounding.js';
	import { statutoryRulesValueSchema } from './+definition.js';
	import ExpressionFields from '../../lib/ui/expression-fields.svelte';
	import { nullableNumberFrom, numberFrom } from '../../lib/ui/renderer-input.js';
	import type { RendererProps } from './$types.js';

	type StatutoryRules = Schema.Schema.Type<typeof statutoryRulesValueSchema>;

	let props: RendererProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const disabled = $derived(props.mode === 'edit' ? props.disabled : true);
	const current = $derived((props.value ?? null) as StatutoryRules | null);

	const ROUNDING_METHODS: readonly RoundingMethod[] = [
		'NONE',
		'NEAREST_CENT',
		'NEAREST_5_CENTS',
		'TRUNCATE_CENT',
		'UP_5_CENTS',
		'NEAREST_UNIT',
		'FLOOR_UNIT',
		'UP_TO_UNIT',
		'TABLE'
	];
	const roundingOptions = ROUNDING_METHODS.map((method) => ({ value: method, label: method }));

	function emit(next: StatutoryRules): void {
		if (props.mode === 'edit') props.onValueChange(next);
	}
</script>

{#snippet expressionField(
	label: string,
	value: string,
	placeholder: string,
	change: (value: string) => void
)}
	<Stack gap="xs">
		<span class="text-sm font-medium">{label}</span>
		<Input
			{value}
			{disabled}
			{placeholder}
			oninput={(event) => change(event.currentTarget.value)}
		/>
		<ExpressionFields site="scheme" expression={value} type="number" />
	</Stack>
{/snippet}

{#snippet flag(label: string, checked: boolean, change: (checked: boolean) => void)}
	<label class="flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			{checked}
			{disabled}
			onchange={(event) => change(event.currentTarget.checked)}
		/>
		{label}
	</label>
{/snippet}

{#if props.mode === 'display'}
	<span class="block truncate" title={current?.relief ?? ''}>
		{current?.relief === '' ? t('renderer.statutory_rules.none') : current?.relief}
	</span>
{:else if current != null}
	<Stack gap="lg">
		{@render expressionField(
			t('renderer.statutory_rules.relief'),
			current.relief,
			'minimum_wage(region) * 12.0',
			(relief) => emit({ ...current, relief })
		)}
		{@render expressionField(
			t('renderer.statutory_rules.base_transform'),
			current.base_transform,
			'bracket(base, 5000.0, 100.0)',
			(base_transform) => emit({ ...current, base_transform })
		)}
		{@render expressionField(
			t('renderer.statutory_rules.share_for_dependants'),
			current.share_for_dependants,
			'share / 100.0 * (1.0 + 0.05 * person.employee.dependents_count)',
			(share_for_dependants) => emit({ ...current, share_for_dependants })
		)}

		<Stack gap="sm">
			<span class="text-sm font-medium">{t('renderer.statutory_rules.rounding')}</span>
			{#each current.rounding as method, index (index)}
				<Grid gap="sm" minimum="compact">
					<Combobox
						options={roundingOptions}
						value={method}
						{disabled}
						searchable={false}
						onValueChange={(next) => {
							if (next)
								emit({
									...current,
									rounding: current.rounding.map((entry, position) =>
										position === index ? next : entry
									)
								});
						}}
					/>
					<Button
						variant="ghost"
						size="sm"
						{disabled}
						onclick={() =>
							emit({
								...current,
								rounding: current.rounding.filter((_entry, position) => position !== index)
							})}
					>
						{t('component.remove')}
					</Button>
				</Grid>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					{disabled}
					onclick={() => emit({ ...current, rounding: [...current.rounding, 'NEAREST_CENT'] })}
				>
					{t('renderer.statutory_rules.add_rounding')}
				</Button>
			</div>
		</Stack>

		<Grid gap="md" minimum="panel">
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('renderer.statutory_rules.no_withholding_below')}
					<Input
						type="number"
						step="0.01"
						value={current.no_withholding_below}
						{disabled}
						oninput={(event) =>
							emit({
								...current,
								no_withholding_below: numberFrom(event.currentTarget.value, 0)
							})}
					/>
				</Stack></label
			>
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('renderer.statutory_rules.shared_cap_group')}
					<Input
						value={current.shared_cap_group ?? ''}
						{disabled}
						oninput={(event) =>
							emit({ ...current, shared_cap_group: event.currentTarget.value.trim() || null })}
					/>
				</Stack></label
			>
			<label class="text-sm font-medium"
				><Stack gap="xs">
					{t('renderer.statutory_rules.employee_share_annual_cap')}
					<Input
						type="number"
						step="0.01"
						value={current.employee_share_annual_cap ?? ''}
						{disabled}
						oninput={(event) =>
							emit({
								...current,
								employee_share_annual_cap: nullableNumberFrom(event.currentTarget.value)
							})}
					/>
				</Stack></label
			>
		</Grid>

		<Stack gap="sm">
			{@render flag(
				t('renderer.statutory_rules.use_period_table'),
				current.use_period_table,
				(use_period_table) => emit({ ...current, use_period_table })
			)}
			{@render flag(
				t('renderer.statutory_rules.additional_remuneration_channel'),
				current.additional_remuneration_channel,
				(additional_remuneration_channel) => emit({ ...current, additional_remuneration_channel })
			)}
			{@render flag(
				t('renderer.statutory_rules.project_relief_annually'),
				current.project_relief_annually,
				(project_relief_annually) => emit({ ...current, project_relief_annually })
			)}
			{@render flag(
				t('renderer.statutory_rules.total_rounded_employee_floored'),
				current.total_rounded_employee_floored,
				(total_rounded_employee_floored) => emit({ ...current, total_rounded_employee_floored })
			)}
		</Stack>
	</Stack>
{/if}
