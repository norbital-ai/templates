<script lang="ts">
	/**
	 * Every field of one `employment_terms` row, in the sections the contract reads them by: pay, shift assignment,
	 * standing, organisation and the dates. The contract detail, the hire form and the terms record all compose this
	 * inside their `Form`, so a term never shows a different set of facts in two places.
	 */
	import EmploymentField from '../EmploymentField.svelte';
	import { t } from '../t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { Combobox, Field, Picker, useForm } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import ContractAllowancesEditor from '../contract-allowances-editor.svelte';
	import DeclaredFactsField from '../declared-facts-field.svelte';
	import type { ContractAllowance } from '../../datatypes/contract_allowances.js';
	import { hrCreateScope } from '../create-scope.js';
	import FormSection from '../form-section.svelte';
	import * as Predicate from 'effect/Predicate';
	import type { VocabularyField } from '../../datatypes/payroll_settings.js';
	import { vocabularyOptions } from './vocabulary-options.svelte.js';
	import CodeSelect from '../code-select.svelte';
	import type { WageKeys } from '../../coded-fields.js';

	let {
		employmentScoped,
		scopedCompanyId
	}: {
		/** The contract is known (the form's values carry it): its picker is not offered. */
		employmentScoped: boolean;
		/** The entity whose patterns and people the pickers offer; unscoped offers all. */
		scopedCompanyId: Id<'companies'> | undefined;
	} = $props();
	const form = useForm();
	/** The lineage whose allowance classes are offered, and the terms' first day that names the version. */
	const settingsCode = hrCreateScope()?.settingsCode();
	const firstDay = $derived.by(() => {
		const range = form?.get('effective_range') as { readonly from?: unknown } | null | undefined;
		const from = range?.from;
		return Predicate.isString(from) && from !== '' ? from : undefined;
	});
	/** The classification codes the version in force on the first day declares. */
	const optionsOf = vocabularyOptions(
		() => settingsCode,
		() => firstDay
	);
</script>

{#snippet coded(name: VocabularyField, label: string, optional: boolean)}
	<Field {name} {label}>
		{#snippet editor(field)}
			<Combobox
				clearable={optional}
				options={optionsOf(name)}
				value={typeof field.value === 'string' && field.value !== '' ? field.value : null}
				disabled={field.disabled}
				onChange={(next) => field.onChange((next ?? (optional ? null : '')) as never)}
			/>
		{/snippet}
	</Field>
{/snippet}

{#snippet sited(name: 'worksite' | 'worksite_sector', wage: WageKeys, label: string)}
	<Field {name} {label}>
		{#snippet editor(field)}
			<CodeSelect
				{settingsCode}
				day={firstDay}
				{wage}
				value={typeof field.value === 'string' ? field.value : null}
				disabled={field.disabled}
				onChange={(next) => field.onChange(next as never)}
			/>
		{/snippet}
	</Field>
{/snippet}

<Stack gap="lg">
	<FormSection
		first
		title={t('component.terms_section_pay')}
		hint={t('component.terms_section_pay_hint')}
	>
		<Grid gap="sm" minimum="compact">
			{#if !employmentScoped}
				<EmploymentField label={t('component.employment')} companyId={scopedCompanyId} />
			{/if}
			<Field name="currency" label={t('component.currency')} />
			<Field name="base_salary" label={t('component.base_salary')} />
			<Field name="pay_frequency" label={t('component.pay_frequency')} />
			<Column span="all">
				<Field
					name="allowances"
					label={t('component.allowances')}
					help={t('component.allowances_hint')}
				>
					{#snippet editor(field)}
						<ContractAllowancesEditor
							value={field.value}
							{settingsCode}
							{firstDay}
							disabled={field.disabled}
							onValueChange={(next: readonly ContractAllowance[]) => field.onChange(next as never)}
						/>
					{/snippet}
				</Field>
			</Column>
		</Grid>
	</FormSection>

	<FormSection title={t('component.shift_assignment')} hint={t('component.shift_assignment_hint')}>
		<Grid gap="sm" minimum="compact">
			<Field
				name="ordinary_hours_per_week"
				label={t('component.ordinary_hours_per_week')}
				help={t('component.ordinary_hours_per_week_hint')}
			/>
			<!-- Part-time premiums (MY Part-Time Regulations, SG Part-Time Regulations) are priced against a comparable full-timer -->
			<Field
				name="comparable_full_time_presence"
				label={t('component.comparable_full_time_presence')}
			/>
			<Field
				name="comparable_full_time_daily_hours"
				label={t('component.comparable_full_time_daily_hours')}
			/>
			<Field
				name="comparable_full_time_weekly_hours"
				label={t('component.comparable_full_time_weekly_hours')}
			/>
			<!-- The entity's own named pattern: a day cycle, or a declared week under which every priced day needs a roster
			     row with a shift. The days a week are the pattern's. -->
			<Field
				name="shift_pattern_id"
				label={t('component.shift_pattern')}
				help={t('component.shift_pattern_hint')}
			>
				{#snippet editor(field)}
					<Picker
						of="shift_patterns"
						label={['code', 'name']}
						{...scopedCompanyId == null ? {} : { where: { company_id: { eq: scopedCompanyId } } }}
						orderBy={{ code: 'asc' }}
						value={typeof field.value === 'string' ? field.value : null}
						onChange={field.onChange}
						disabled={field.disabled}
					/>
				{/snippet}
			</Field>
		</Grid>
	</FormSection>

	<FormSection title={t('component.standing')} hint={t('component.terms_section_standing_hint')}>
		<Grid gap="sm" minimum="compact">
			<Field name="employment_type" label={t('component.employment_type')} />
			<Field name="residency_status" label={t('component.residency_status')} />
			<Field name="residency_since" label={t('component.residency_since')} />
			{@render coded('work_classification', t('component.classification'), false)}
			{@render coded('statutory_work_category', t('component.statutory_work_category'), false)}
			<Field name="weather_dependent_piece" label={t('component.weather_dependent_piece')} />
			<Field name="grade" label={t('component.grade')} />
			{@render coded('pass_type', t('component.pass_type'), true)}
			{@render coded('tax_residency', t('component.tax_residency'), true)}
			<Field name="notice_days" label={t('component.notice_days')} />
			<Field name="paid_rest_days" label={t('component.paid_rest_days')} />
			<!-- Absence decided before the workspace's first work day, read by an absence-forfeiture test -->
			<Field
				name="opening_attendance_through"
				label={t('component.opening_attendance_through')}
				help={t('component.opening_attendance_hint')}
			/>
			<Field
				name="opening_unexcused_absence_days"
				label={t('component.opening_unexcused_absence_days')}
			/>
			<Field
				name="opening_attendance_reference"
				label={t('component.opening_attendance_reference')}
			/>
			<Field name="proration" label={t('component.proration')} />
			<!-- The worksite and sector the wage order prices: its own keys, as the write checks them -->
			{@render sited('worksite', 'places', t('component.worksite'))}
			{@render sited('worksite_sector', 'sectors', t('component.worksite_sector'))}
			<Field name="worksite_id" label={t('component.worksite_site')} />
			<!-- The jurisdiction inputs the lineage declares for contract terms (`terms_facts`) -->
			<Column span="all">
				<Field
					name="facts"
					label={t('component.terms_facts')}
					help={t('component.terms_facts_hint')}
				>
					{#snippet editor(field)}
						<DeclaredFactsField
							view={{
								mode: 'edit',
								name: field.name,
								value: field.value as never,
								disabled: field.disabled,
								onChange: field.onChange as never
							}}
							{settingsCode}
							schema="terms_facts"
							day={firstDay}
						/>
					{/snippet}
				</Field>
			</Column>
		</Grid>
	</FormSection>

	<FormSection
		title={t('component.terms_section_organisation')}
		hint={t('component.terms_section_organisation_hint')}
	>
		<Grid gap="sm" minimum="compact">
			<Field name="job_title" label={t('component.job_title')} />
			<Field name="department" label={t('component.department')} />
			<Field name="payroll_group" label={t('component.payroll_group')} />
		</Grid>
	</FormSection>

	<FormSection title={t('component.section_period')} hint={t('component.section_period_hint')}>
		<Grid gap="sm" minimum="compact">
			<Column span="all">
				<Field name="effective_range" label={t('component.effective_period')} />
			</Column>
		</Grid>
	</FormSection>
</Stack>
