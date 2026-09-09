<script lang="ts">
	/**
	 * One expense claim: the type it is priced as, how much, the day it was incurred, the receipt
	 * that proves it, and how it settles.
	 *
	 * Every field is a column of `claim_requests`; the family is the table, so the type picker reads
	 * `claim_catalogue` and nothing else. It offers only the types whose eligibility holds for the
	 * person today (`EligibleTypes`), and the hook holds the same rule on the event date.
	 *
	 * Self-service opens this same form. `employment_id` is prefilled and hidden when the create
	 * scope names the person, because an employee raising their own claim is not choosing whose it
	 * is — the same arrangement `leave_entries` uses.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import { employmentRelationOptions, hrCreateScope } from '../../lib/ui/create-scope.js';
	import EligibleTypes from '../../lib/ui/eligible-types.svelte';
	import FormSection from '../../lib/ui/form-section.svelte';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);

	/**
	 * The capture, read for the lock and for nothing else: the badge `sourceLockRecordMetadata`
	 * produces is the one statement that payroll has taken this row. An approved claim stays
	 * editable until the capture exists: approval is workflow, consumption is settlement.
	 */
	const settledBy = $derived(
		record?.settled_period == null ? null : { period: record.settled_period }
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
</script>

<RecordShell
	title={record
		? `${formatCalendarDate(record.incurred_on)} · ${formatNumeric(record.amount)}`
		: t('component.create_claim')}
>
	<CollectionForm
		{client}
		collection="claim_requests"
		defaultValues={formValues}
		{recordMetadata}
		submitLabel={record ? t('component.save_claim') : t('component.create_claim')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field, form })}
			{@const employmentId =
				scopedEmploymentId ?? (String(form.values().employment_id ?? '') || undefined)}
			<Field name="settled_payslip_id" hidden />
			<Field name="settled_period" hidden />
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.claim_section_claim')}
					hint={t('component.claim_section_claim_hint')}
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
							catalogue="claim_catalogue"
							{employmentId}
							settingsCode={scopedSettingsCode}
						>
							{#snippet children(where)}
								<Field
									name="claim_catalogue_id"
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
						<Field name="incurred_on" label={t('component.incurred_on')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.section_proof')}
					hint={t('component.claim_section_proof_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence_file" label={t('component.evidence_file')} />
						<Column span="all">
							<Field name="description" label={t('component.claim_description')} />
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
