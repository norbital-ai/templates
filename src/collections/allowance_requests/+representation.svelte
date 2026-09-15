<script lang="ts">
	/**
	 * One standing allowance: the type it is paid as, how much, whether it is paid once or across a
	 * window, the receipt when the type asks for one, and whether it claws an earlier line back.
	 *
	 * The only one of the request forms with no date field: a one-off's period and a recurring
	 * window are both the recurrence, and the period a one-off settles in is the period it names.
	 * The recurrence renderer *is* the cadence toggle: the arm and the payload are one value, so
	 * nothing is left for a second control to desynchronise from.
	 *
	 * The type picker offers only the types whose eligibility holds for the person today
	 * (`EligibleTypes`); the hook holds the same rule on the event date.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatNumeric } from '../../lib/ui/display-formatters.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import EligibleTypes from '../../lib/ui/eligible-types.svelte';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys | UiKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	// A create starts with the claw-back switch at No: the column defaults to false, but a form
	// value the person never touched is undefined, and the form reads undefined as required.
	const formValues = $derived(
		record ?? {
			as_adjustment_entry: false,
			...(scopedEmploymentId ? { employment_id: scopedEmploymentId } : {})
		}
	);

	/** The capture is the row's own nullable `payslip_id`; there is no second read. */
	const settledBy = $derived(record?.payslip_id == null ? null : { period: '' });
	const lock = $derived(
		record
			? sourceLock({
					existing: true,
					approvalId: record.approval_id,
					dates: [],
					settledBy,
					datePassed: 'IS_NOT_A_LOCK'
				})
			: { kind: 'NONE' as const }
	);
	const recordMetadata = $derived(sourceLockRecordMetadata(lock, t));
	/** A payroll capture freezes the row: the shell header carries the lock, the chrome the sentence. */
	const locked = $derived(recordMetadata.length > 0);
</script>

<RecordShell
	icon={locked ? 'lucide:lock-keyhole' : undefined}
	badge={locked ? t('recordMetadata.readOnly') : undefined}
>
	<CollectionForm
		{client}
		notice="header"
		collection="allowance_requests"
		defaultValues={formValues}
		{recordMetadata}
		submitLabel={record ? t('component.save_allowance') : t('component.create_allowance')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const employmentId =
				scopedEmploymentId ?? (String(form.values().employment_id ?? '') || undefined)}
			<!-- The payroll engine owns both: `payslip_id` is the capture lock, and a per-period row
			     materialised from a standing allowance carries the source it came from. -->
			<Field name="payslip_id" hidden />
			<Field name="derived_from_id" hidden />
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

				<FormSection title={t('component.allowance_section_when')}>
					<Field
						name="recurrence"
						label={t('component.entry_cadence')}
						description={t('component.allowance_section_when_hint')}
					/>
				</FormSection>

				<FormSection title={t('component.section_proof')} hint={t('component.section_proof_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence_file" label={t('component.evidence_file')} />
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
