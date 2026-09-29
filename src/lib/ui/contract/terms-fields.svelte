<script lang="ts">
	/**
	 * Every field of one `employment_terms` row, in the sections the contract reads them by: pay, shift assignment,
	 * standing, organisation and the dates. The contract detail, the hire form and the terms record all compose this
	 * inside their `Form`, so a term never shows a different set of facts in two places.
	 */
	import EmploymentField from '../EmploymentField.svelte';
	import { t } from '../t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Picker, useForm } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import ContractAllowancesEditor from '../contract-allowances-editor.svelte';
	import type { ContractAllowance } from '../../datatypes/contract_allowances.js';
	import { hrCreateScope } from '../create-scope.js';
	import FormSection from '../form-section.svelte';
	import * as Predicate from 'effect/Predicate';

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
</script>

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
			<Field name="work_classification" label={t('component.classification')} />
			<Field name="statutory_work_category" label={t('component.statutory_work_category')} />
			<Field name="hazardous_work" label={t('component.hazardous_work')} />
			<Field name="th_pregnancy_status" label="Thai pregnancy status (dated terms)" />
			<Field name="weather_dependent_piece" label={t('component.weather_dependent_piece')} />
			<Field name="grade" label={t('component.grade')} />
			{#if settingsCode === 'ID'}
				<Field name="id_wage_scale_grade" label={t('component.id_wage_scale_grade')} />
				<Field
					name="id_wage_scale_basic_minimum"
					label={t('component.id_wage_scale_basic_minimum')}
				/>
				<Field
					name="id_wage_scale_effective_on"
					label={t('component.id_wage_scale_effective_on')}
				/>
				<Field name="id_wage_scale_notice_on" label={t('component.id_wage_scale_notice_on')} />
				<Field name="id_wage_scale_reference" label={t('component.id_wage_scale_reference')} />
				<Field
					name="id_wage_scale_evidence_file"
					label={t('component.id_wage_scale_evidence_file')}
				/>
				<Field
					name="id_foreign_prior_indonesia_work"
					label={t('component.id_foreign_prior_indonesia_work')}
				/>
				<Field
					name="id_foreign_prior_work_reviewed_on"
					label={t('component.id_foreign_prior_work_reviewed_on')}
				/>
				<Field
					name="id_foreign_prior_work_reference"
					label={t('component.id_foreign_prior_work_reference')}
				/>
			{/if}
			<Field name="pass_type" label={t('component.pass_type')} />
			<Field name="tax_residency" label={t('component.tax_residency')} />
			<Field name="notice_days" label={t('component.notice_days')} />
			<!-- CN LCL arts.14, 19–20, 82–83: the probation, the wage after it and an overdue open-ended contract -->
			<Field name="probation_end" label={t('component.probation_end')} />
			<Field name="post_probation_wage" label={t('component.post_probation_wage')} />
			<Field name="open_ended_due_on" label={t('component.open_ended_due_on')} />
			<Field name="paid_rest_days" label={t('component.paid_rest_days')} />
			<Field name="proration" label={t('component.proration')} />
			<!-- VN Decree 293/2025 art. 5(5): the worksite's 2025 region and whether 2026 reclassified it lower -->
			<Field name="minimum_wage_2025_region" label={t('component.minimum_wage_2025_region')} />
			<Field
				name="minimum_wage_2026_area_reclassified"
				label={t('component.minimum_wage_2026_area_reclassified')}
			/>
			<!-- TH Minimum Wage Notice 14: the worksite and sector the daily rate is read at -->
			<Field name="worksite" label={t('component.worksite')} />
			{#if settingsCode === 'PH'}
				<Field name="ph_worksite_source_reference" label="Worksite municipality source reference" />
				<Field name="ph_worksite_source_file" label="Worksite municipality source file" />
			{/if}
			<Field name="worksite_state" label={t('component.worksite_state')} />
			<Field name="worksite_sector" label={t('component.worksite_sector')} />
			{#if settingsCode === 'PH'}
				<Field name="ph_sector_source_reference" label="Wage sector source reference" />
				<Field name="ph_sector_source_file" label="Wage sector source file" />
			{/if}
			<Field name="worksite_sector_edition" label={t('component.worksite_sector_edition')} />
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
