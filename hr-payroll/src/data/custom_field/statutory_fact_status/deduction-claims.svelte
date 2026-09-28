<script lang="ts">
	import RowList from '../../../lib/ui/row-list.svelte';
	import Labelled from '../../../lib/ui/Labelled.svelte';
	import { t } from '../../../lib/ui/t.js';

	import { Combobox, MonthInput } from '@norbital-ai/ui';
	import { Input } from '@norbital-ai/ui';
	import { Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import type { StatutoryDeductionClaim } from '../../../lib/datatypes/statutory_fact_status.js';
	import { deductionTotals } from '../../../lib/statutory-deductions.js';

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
			['ZAKAT', t('renderer.statutory_deductions.category.zakat')],
			['DEPARTURE_LEVY', t('renderer.statutory_deductions.category.departure_levy')],
			['SERVICE_COSTS', t('renderer.statutory_deductions.category.service_costs')]
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
	<RowList
		rows={value}
		{disabled}
		addLabel={t('renderer.statutory_deductions.add')}
		add={() =>
			onChange([
				...value,
				{ period: month, category: 'LIFESTYLE', amount: 0, source: 'EMPLOYEE', reference: '' }
			])}
		removeLabel={t('renderer.statutory_deductions.remove')}
		remove={(index) => edit(index, null)}
	>
		{#snippet row(row, index)}
			<Labelled label={t('renderer.statutory_deductions.claim_month')}>
				<MonthInput
					value={row.period || null}
					{disabled}
					onChange={(period) => edit(index, { period: period ?? '' })}
				/>
			</Labelled>
			<Labelled label={t('renderer.statutory_deductions.category_label')}>
				<Combobox
					class="w-64 max-w-full"
					size="sm"
					options={categories}
					value={row.category}
					{disabled}
					onChange={(category) => {
						if (category) edit(index, { category });
					}}
				/>
			</Labelled>
			<Labelled label={t('renderer.statutory_deductions.claim_amount')}>
				<Input
					type="number"
					step="0.01"
					value={row.amount}
					{disabled}
					oninput={(event) => edit(index, { amount: Number(event.currentTarget.value) || 0 })}
				/>
			</Labelled>
			<Labelled label={t('renderer.statutory_deductions.claim_source')}>
				<Combobox
					class="w-64 max-w-full"
					size="sm"
					options={sources}
					value={row.source}
					{disabled}
					onChange={(source) => {
						if (source === 'EMPLOYEE' || source === 'PRIOR_EMPLOYER') edit(index, { source });
					}}
				/>
			</Labelled>
			<Labelled label={t('renderer.statutory_deductions.reference')}>
				<Input
					value={row.reference}
					{disabled}
					oninput={(event) => edit(index, { reference: event.currentTarget.value })}
				/>
			</Labelled>
			{#if row.category === 'DEPARTURE_LEVY'}
				<Labelled label={t('renderer.statutory_deductions.event_reference')}>
					<Input
						value={row.event_reference ?? ''}
						{disabled}
						oninput={(event) => edit(index, { event_reference: event.currentTarget.value })}
					/>
				</Labelled>
			{/if}
		{/snippet}
	</RowList>
	{#if value.some((claim) => claim.category === 'HOME_INTEREST')}
		<Grid gap="sm" minimum="compact">
			{#each homeFields as field (field.key)}
				<Labelled label={field.label}>
					<Input
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
					/>
				</Labelled>
			{/each}
		</Grid>
		<p class="text-meta">{t('renderer.statutory_deductions.home_hint')}</p>
	{/if}
	{#if value.length > 0}
		<Labelled label={t('renderer.statutory_deductions.audit_month')}>
			<MonthInput value={month || null} onChange={(next) => (month = next ?? '')} />
		</Labelled>
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
