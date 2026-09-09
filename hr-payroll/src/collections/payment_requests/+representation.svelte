<script lang="ts">
	/**
	 * One payment: the type it is priced as, how much, the day it takes effect and why, the
	 * receipt when the type asks for one, and how it settles.
	 *
	 * The type picker offers only the types whose eligibility holds for the person today
	 * (`EligibleTypes`); the hook holds the same rule on the event date.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
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
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const scopedEmploymentId = $derived(createScope?.employmentId?.());
	const scopedCompanyId = $derived(createScope?.companyId());
	const scopedSettingsCode = $derived(createScope?.settingsCode());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);

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
		? `${formatCalendarInstant(record.effective_on)} · ${formatNumeric(record.amount)}`
		: t('component.create_payment')}
>
	<CollectionForm
		{client}
		collection="payment_requests"
		defaultValues={formValues}
		{recordMetadata}
		submitLabel={record ? t('component.save_payment') : t('component.create_payment')}
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
					title={t('component.payment_section_payment')}
					hint={t('component.payment_section_payment_hint')}
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
							catalogue="payment_catalogue"
							{employmentId}
							settingsCode={scopedSettingsCode}
						>
							{#snippet children(where)}
								<Field
									name="payment_catalogue_id"
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
						<Field name="effective_on" label={t('component.effective_on')} />
						<Column span="all">
							<Field name="reason" label={t('component.payment_reason')} />
						</Column>
					</Grid>
				</FormSection>

				<FormSection title={t('component.section_proof')} hint={t('component.section_proof_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence_file" label={t('component.evidence_file')} />
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
