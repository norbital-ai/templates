<script lang="ts">
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	const { t } = useI18n<TenantI18nKeys>();
	import { Button } from '@norbital-ai/ui/button';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Input } from '@norbital-ai/ui/input';
	import { Cluster, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import type { StatutoryDeductionClaim } from './+definition.js';
	import { deductionTotals } from '../../lib/statutory-deductions.js';

	let {
		value,
		elections,
		disabled,
		onChange,
		onElectionsChange
	}: {
		value: readonly StatutoryDeductionClaim[];
		elections: Readonly<Record<string, string | number | boolean>>;
		disabled: boolean;
		onChange: (value: readonly StatutoryDeductionClaim[]) => void;
		onElectionsChange: (value: Readonly<Record<string, string | number | boolean>>) => void;
	} = $props();
	let month = $state(new Date().toISOString().slice(0, 7));
	const totals = $derived(deductionTotals(value, `${month.slice(0, 4)}-01-01`, month));
	const categories = $derived(
		[
			['PARENTS_CARE', t('renderer.statutory_deductions.category.parents_care')],
			['PARENTS_CHECKUP', t('renderer.statutory_deductions.category.parents_checkup')],
			['DISABILITY_EQUIPMENT', t('renderer.statutory_deductions.category.disability_equipment')],
			['SELF_EDUCATION', t('renderer.statutory_deductions.category.self_education')],
			['UPSKILLING', t('renderer.statutory_deductions.category.upskilling')],
			['SERIOUS_MEDICAL', t('renderer.statutory_deductions.category.serious_medical')],
			['VACCINATION', t('renderer.statutory_deductions.category.vaccination')],
			['DENTAL', t('renderer.statutory_deductions.category.dental')],
			['MEDICAL_SCREENING', t('renderer.statutory_deductions.category.medical_screening')],
			['LEARNING_DISABILITY', t('renderer.statutory_deductions.category.learning_disability')],
			['LIFESTYLE', t('renderer.statutory_deductions.category.lifestyle')],
			['SPORTS', t('renderer.statutory_deductions.category.sports')],
			['BREASTFEEDING', t('renderer.statutory_deductions.category.breastfeeding')],
			['CHILDCARE', t('renderer.statutory_deductions.category.childcare')],
			['SSPN', t('renderer.statutory_deductions.category.sspn')],
			['ALIMONY', t('renderer.statutory_deductions.category.alimony')],
			['VOLUNTARY_EPF', t('renderer.statutory_deductions.category.voluntary_epf')],
			['LIFE_INSURANCE_EPF', t('renderer.statutory_deductions.category.life_insurance_epf')],
			['PRIVATE_RETIREMENT', t('renderer.statutory_deductions.category.private_retirement')],
			[
				'EDUCATION_MEDICAL_INSURANCE',
				t('renderer.statutory_deductions.category.education_medical_insurance')
			],
			['SOCSO_EIS', t('renderer.statutory_deductions.category.socso_eis')],
			['EV_CHARGING', t('renderer.statutory_deductions.category.ev_charging')],
			['COMPOST', t('renderer.statutory_deductions.category.compost')],
			['FOOD_GRINDER_CCTV', t('renderer.statutory_deductions.category.food_grinder_cctv')],
			['HOME_INTEREST', t('renderer.statutory_deductions.category.home_interest')],
			['TOURISM', t('renderer.statutory_deductions.category.tourism')],
			['ZAKAT_EXTERNAL', t('renderer.statutory_deductions.category.zakat_external')],
			['DEPARTURE_LEVY', t('renderer.statutory_deductions.category.departure_levy')]
		].map(([value, label]) => ({ value: value!, label: label! }))
	);
	const sources = $derived([
		{ value: 'EMPLOYEE', label: t('renderer.statutory_deductions.employee_source') },
		{ value: 'PRIOR_EMPLOYER', label: t('renderer.statutory_deductions.prior_source') }
	]);
	const homeFields = $derived([
		{ key: 'tp1_home_price', label: t('renderer.statutory_deductions.home_price'), type: 'number' },
		{
			key: 'tp1_home_spa_date',
			label: t('renderer.statutory_deductions.home_spa_date'),
			type: 'date'
		},
		{
			key: 'tp1_home_first_interest_year',
			label: t('renderer.statutory_deductions.home_first_interest'),
			type: 'number'
		},
		{
			key: 'tp1_home_total_interest',
			label: t('renderer.statutory_deductions.home_total_interest'),
			type: 'number'
		}
	]);
	function edit(index: number, change: Partial<StatutoryDeductionClaim> | null): void {
		onChange(
			change === null
				? value.filter((_, position) => position !== index)
				: value.map((row, position) => (position === index ? { ...row, ...change } : row))
		);
	}
</script>

<Stack gap="sm">
	<p class="text-meta">{t('renderer.statutory_deductions.hint')}</p>
	{#each value as row, index (index)}
		<Grid gap="sm" minimum="compact" class="border-b border-border pb-3">
			<label class="text-sm"
				><Stack gap="xs"
					>{t('renderer.statutory_deductions.claim_month')}<Input
						type="month"
						value={row.period}
						{disabled}
						oninput={(event) => edit(index, { period: event.currentTarget.value })}
					/></Stack
				></label
			>
			<label class="text-sm"
				><Stack gap="xs"
					>{t('renderer.statutory_deductions.category_label')}<Combobox
						options={categories}
						value={row.category}
						{disabled}
						onValueChange={(category) => {
							if (category) edit(index, { category });
						}}
					/></Stack
				></label
			>
			<label class="text-sm"
				><Stack gap="xs"
					>{t('renderer.statutory_deductions.claim_amount')}<Input
						type="number"
						step="0.01"
						value={row.amount}
						{disabled}
						oninput={(event) => edit(index, { amount: Number(event.currentTarget.value) || 0 })}
					/></Stack
				></label
			>
			<label class="text-sm"
				><Stack gap="xs"
					>{t('renderer.statutory_deductions.claim_source')}<Combobox
						options={sources}
						value={row.source}
						{disabled}
						searchable={false}
						onValueChange={(source) => {
							if (source === 'EMPLOYEE' || source === 'PRIOR_EMPLOYER') edit(index, { source });
						}}
					/></Stack
				></label
			>
			<label class="text-sm"
				><Stack gap="xs"
					>{t('renderer.statutory_deductions.reference')}<Input
						value={row.reference}
						{disabled}
						oninput={(event) => edit(index, { reference: event.currentTarget.value })}
					/></Stack
				></label
			>
			{#if row.category === 'DEPARTURE_LEVY'}
				<label class="text-sm"
					><Stack gap="xs"
						>{t('renderer.statutory_deductions.event_reference')}<Input
							value={row.event_reference ?? ''}
							{disabled}
							oninput={(event) => edit(index, { event_reference: event.currentTarget.value })}
						/></Stack
					></label
				>
			{/if}
			<Cluster
				><Button variant="ghost" size="sm" {disabled} onclick={() => edit(index, null)}
					>{t('renderer.statutory_deductions.remove')}</Button
				></Cluster
			>
		</Grid>
	{/each}
	<Cluster
		><Button
			variant="outline"
			size="sm"
			{disabled}
			onclick={() =>
				onChange([
					...value,
					{ period: month, category: 'LIFESTYLE', amount: 0, source: 'EMPLOYEE', reference: '' }
				])}>{t('renderer.statutory_deductions.add')}</Button
		></Cluster
	>
	{#if value.some((claim) => claim.category === 'HOME_INTEREST')}
		<Grid gap="sm" minimum="compact">
			{#each homeFields as field (field.key)}
				<label class="text-sm"
					><Stack gap="xs"
						>{field.label}<Input
							type={field.type}
							value={String(elections[field.key] ?? '')}
							{disabled}
							oninput={(event) =>
								onElectionsChange({
									...elections,
									[field.key]:
										field.type === 'number'
											? Number(event.currentTarget.value)
											: event.currentTarget.value
								})}
						/></Stack
					></label
				>
			{/each}
		</Grid>
		<p class="text-meta">{t('renderer.statutory_deductions.home_hint')}</p>
	{/if}
	{#if value.length > 0}
		<label class="text-sm"
			><Stack gap="xs"
				>{t('renderer.statutory_deductions.audit_month')}<Input
					type="month"
					bind:value={month}
				/></Stack
			></label
		>
		<p class="text-meta">{t('renderer.statutory_deductions.audit_hint')}</p>
		<Scroll name={t('renderer.statutory_deductions.audit_month')} axis="x">
			<table class="w-full text-left text-sm">
				<thead
					><tr
						><th>{t('renderer.statutory_deductions.audit_category')}</th><th
							>{t('renderer.statutory_deductions.audit_prior')}</th
						><th>{t('renderer.statutory_deductions.audit_current')}</th><th
							>{t('renderer.statutory_deductions.audit_total')}</th
						></tr
					></thead
				>
				<tbody>
					{#each Object.keys(totals.deductions).sort() as category (category)}
						<tr
							><td>{categories.find((row) => row.value === category)?.label ?? category}</td><td
								>{(totals.deductions_prior[category] ?? 0).toFixed(2)}</td
							><td>{(totals.deductions_current[category] ?? 0).toFixed(2)}</td><td
								>{(totals.deductions[category] ?? 0).toFixed(2)}</td
							></tr
						>
					{/each}
				</tbody>
			</table>
		</Scroll>
	{/if}
</Stack>
