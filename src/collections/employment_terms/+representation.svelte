<script lang="ts">
	/**
	 * One contract's terms: what it pays, where the person stands, where they sit, and the dates it
	 * holds across. The standing and organisation columns are the parameters every catalogue's
	 * eligibility reads; nothing else on the contract decides an entitlement.
	 *
	 * The employment picker is the page's own entity, and is prefilled and hidden when the scope
	 * names the employment (a profile opened on one contract).
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);
</script>

<RecordShell title={record?.summary ?? t('component.create_terms')}>
	<CollectionForm
		{client}
		collection="employment_terms"
		defaultValues={formValues}
		submitLabel={record ? t('component.save_terms') : t('component.create_terms')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.terms_section_pay')}
					hint={t('component.terms_section_pay_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if scopedEmploymentId != null}
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
						<!--
							The base the terms project their days from, picked from the entity's own named
							patterns. Empty means rostered as assigned: every day is a roster row and nothing is
							projected.
						-->
						<Field
							name="shift_pattern_id"
							label={t('component.shift_pattern')}
							relationOptions={{
								label: (pattern) =>
									pattern.code != null && pattern.code !== ''
										? `${String(pattern.code)} · ${String(pattern.name ?? '')}`
										: '—',
								...(scopedCompanyId == null
									? {}
									: { where: { company_id: { eq: scopedCompanyId } } }),
								orderBy: { code: 'asc' },
								limit: 500
							}}
						/>
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.standing')}
					hint={t('component.terms_section_standing_hint')}
				>
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

				<FormSection
					title={t('component.section_period')}
					hint={t('component.section_period_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Column span="all">
							<Field name="effective_range" label={t('component.effective_period')} />
						</Column>
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
