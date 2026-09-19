<script lang="ts">
	/**
	 * One ad hoc payment: the class it is priced as, how much (or nothing, where the class's bands
	 * price it from the person), the day it is for, the decision behind it, and how it settles.
	 *
	 * Every field is a column of `adhoc_requests`; the type picker reads `adhoc_catalogue` and
	 * nothing else, offering only the classes whose eligibility holds for the person today
	 * (`EligibleTypes`); the transform holds the same rule on the event date. HR raises these from
	 * the Events page; off-boarding raises the separation classes.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n, type UiKeys } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatCalendarInstant, formatNumeric } from '../../lib/ui/display-formatters.js';
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

	/**
	 * The capture, read for the lock and for nothing else: the badge `sourceLockRecordMetadata`
	 * produces is the one statement that payroll has taken this row. An approved request stays
	 * editable until the capture exists: approval is workflow, consumption is settlement.
	 */
	const settledBy = $derived(
		record?.payslip_id == null ? null : { period: record.pay_period ?? '' }
	);
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
</script>

<RecordShell>
	<CollectionForm
		{client}
		notice="header"
		collection="adhoc_requests"
		defaultValues={formValues}
		{recordMetadata}
		submitLabel={record ? t('component.save_adhoc') : t('component.create_adhoc')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const employmentId =
				scopedEmploymentId ?? (String(form.values().employment_id ?? '') || undefined)}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.adhoc_section_payment')}
					hint={t('component.adhoc_section_payment_hint')}
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
							catalogue="adhoc_catalogue"
							{employmentId}
							settingsCode={scopedSettingsCode}
						>
							{#snippet children(where)}
								<Field
									name="catalogue_id"
									label={t('component.type')}
									relationOptions={{
										label: (row) => [row.code, row.name].filter(Boolean).join(' · '),
										where,
										orderBy: { code: 'asc' },
										limit: 500
									}}
								/>
							{/snippet}
						</EligibleTypes>
						<Field name="amount" label={t('component.entry_amount')} />
						<Field name="event_date" label={t('component.adhoc_event_date')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.section_proof')}
					hint={t('component.adhoc_section_proof_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence_file" label={t('component.evidence_file')} />
						<Column span="all">
							<Field name="reason" label={t('component.adhoc_reason')} />
						</Column>
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.section_settlement')}
					hint={t('component.section_settlement_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="pay_period" label={t('component.pay_period_override')} />
						<Field name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
</RecordShell>
