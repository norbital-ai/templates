<script lang="ts">
	/**
	 * One standing allowance: the type it is paid as, the monthly amount, the window it is in force
	 * over, the receipt when the type asks for one, and whether it claws an earlier line back.
	 *
	 * There is no period field: the window is the period. Each payroll run that touches it prices
	 * one entry, prorated like basic salary, and the entries are read beside the source on the
	 * Allowances page. Once a payslip has priced the allowance the amount, the type, the person and
	 * the opening day are history; the transform lets only the closing day move, forward.
	 *
	 * The type picker offers only the types whose eligibility holds for the person today
	 * (`EligibleTypes`); the transform holds the same rule on the opening day.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import EligibleTypes from '../../lib/ui/eligible-types.svelte';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	const scopedFrom = $derived(createScope?.allowanceFrom?.());
	// A create starts with the claw-back switch at No: the column defaults to false, but a form
	// value the person never touched is undefined, and the form reads undefined as required.
	const formValues = $derived(
		record ?? {
			as_adjustment_entry: false,
			...(scopedEmploymentId ? { employment_id: scopedEmploymentId } : {}),
			// The period this form was opened on is the day the allowance opens.
			...(scopedFrom ? { effective_from: scopedFrom } : {})
		}
	);

	const lock = $derived(
		record
			? sourceLock({
					existing: true,
					approvalId: record.approval_id,
					dates: [],
					settledBy: null,
					datePassed: 'IS_NOT_A_LOCK'
				})
			: { kind: 'NONE' as const }
	);
	const recordMetadata = $derived(sourceLockRecordMetadata(lock, t));
</script>

<RecordShell>
	<CollectionForm
		{client}
		notice="header"
		collection="allowances"
		defaultValues={formValues}
		{recordMetadata}
		submitLabel={record ? t('component.save_allowance') : t('component.create_allowance')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const employmentId =
				scopedEmploymentId ?? (String(form.values().employment_id ?? '') || undefined)}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.allowance_section_allowance')}
					hint={t('component.allowance_section_allowance_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if scopedEmploymentId != null}
							<Field name="employment_id" hidden />
						{:else}
							<Field
								name="employment_id"
								label={t('component.person')}
								relationOptions={employmentRelationOptions(scopedCompanyId)}
							/>
						{/if}
						<EligibleTypes
							catalogue="allowance_catalogue"
							{employmentId}
							settingsCode={scopedSettingsCode}
						>
							{#snippet children(where)}
								<Field
									name="catalogue_id"
									label={t('component.type')}
									relationOptions={{
										label: (component) => String(component.code ?? '') || '—',
										where,
										orderBy: { code: 'asc' },
										limit: 500
									}}
								/>
							{/snippet}
						</EligibleTypes>
						<Field name="amount" label={t('component.entry_amount')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.allowance_section_when')}
					hint={t('component.allowance_section_when_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="effective_from" label={t('component.effective_from')} />
						<Field name="effective_to" label={t('component.effective_to')} />
					</Grid>
				</FormSection>

				<FormSection title={t('component.section_proof')} hint={t('component.section_proof_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence_file" label={t('component.evidence_file')} />
						<Field name="reason" label={t('component.reason')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.section_settlement')}
					hint={t('component.allowance_section_settlement_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
