<script lang="ts">
	/**
	 * Every field of one `employment_terms` row, in the sections the contract reads them by: pay,
	 * shift assignment, standing, organisation and the dates. The contract detail and the terms
	 * record both compose this, so a term never shows a different set of facts in two places.
	 */
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceCollections } from '$bolt/client';
	import type { CollectionFormComposition } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { employmentRelationOptions } from '../create-scope.js';
	import FormSection from '../form-section.svelte';

	/** The `Field` a `CollectionForm` on `employment_terms` composes with. */
	export type TermsFieldComponent = CollectionFormComposition<
		WorkspaceCollections,
		'employment_terms'
	>['Field'];

	let {
		Field,
		employmentScoped,
		scopedCompanyId
	}: {
		Field: TermsFieldComponent;
		/** The contract is known: its picker is prefilled and hidden. */
		employmentScoped: boolean;
		/** The entity whose patterns and people the pickers offer; unscoped offers all. */
		scopedCompanyId: string | undefined;
	} = $props();
	const { t } = useI18n<TenantI18nKeys>();
</script>

<Stack gap="lg">
	<FormSection
		first
		title={t('component.terms_section_pay')}
		hint={t('component.terms_section_pay_hint')}
	>
		<Grid gap="sm" minimum="compact">
			{#if employmentScoped}
				<Field name="employment_id" hidden />
			{:else}
				<Field
					name="employment_id"
					label={t('component.employment')}
					relationOptions={employmentRelationOptions(scopedCompanyId)}
				/>
			{/if}
			<Field name="base_salary" label={t('component.base_salary')} />
			<Field name="pay_frequency" label={t('component.pay_frequency')} />
		</Grid>
	</FormSection>

	<FormSection title={t('component.shift_assignment')} hint={t('component.shift_assignment_hint')}>
		<Grid gap="sm" minimum="compact">
			<Field name="agreed_days_per_week" label={t('component.agreed_days_per_week')} />
			<!--
				Optional: the entity's own named cycle. Empty means rostered — every priced day needs a
				roster row with a shift, and the transform refuses a cycle whose weeks disagree with the
				agreed days.
			-->
			<Field
				name="shift_pattern_id"
				label={t('component.shift_pattern')}
				description={t('component.shift_pattern_hint')}
				relationOptions={{
					label: (pattern) =>
						pattern.code != null && pattern.code !== ''
							? `${String(pattern.code)} · ${String(pattern.name ?? '')}`
							: '—',
					...(scopedCompanyId == null ? {} : { where: { company_id: { eq: scopedCompanyId } } }),
					orderBy: { code: 'asc' },
					limit: 500
				}}
			/>
		</Grid>
	</FormSection>

	<FormSection title={t('component.standing')} hint={t('component.terms_section_standing_hint')}>
		<Grid gap="sm" minimum="compact">
			<Field name="employment_type" label={t('component.employment_type')} />
			<Field name="residency_status" label={t('component.residency_status')} />
			<Field name="residency_since" label={t('component.residency_since')} />
			<Field name="work_classification" label={t('component.classification')} />
			<Field name="statutory_work_category" label={t('component.statutory_work_category')} />
			<Field name="grade" label={t('component.grade')} />
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
