<script lang="ts">
	/**
	 * One claim or ad hoc request: the type it is priced as, how much, the day it is for, the
	 * evidence and how it settles. The two families are one form over their own collection; the
	 * type picker reads that family's catalogue and offers only the rows whose eligibility holds
	 * for the person today (`EligibleTypes`); the transform holds the same rule on the event date.
	 *
	 * Self-service opens this same form: `employment_id` is prefilled and not offered when the
	 * create scope names the person. A payslip that took the row locks it, and the frame says so.
	 */
	import EmploymentField from './EmploymentField.svelte';
	import { t } from './t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { Field, Form, Picker } from '@norbital-ai/ui';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import { sourceLock, sourceLockRecordMetadata } from '../scheduling/lock.js';
	import { createValues, hrCreateScope } from './create-scope.js';
	import { openCreated } from './open-created.js';
	import EligibleTypes from './eligible-types.svelte';
	import FormSection from './form-section.svelte';
	import RequestFactsField from './request-facts-field.svelte';
	import * as Predicate from 'effect/Predicate';

	const FAMILY = {
		claim: {
			collection: 'claim_requests',
			catalogue: 'claim_catalogue',
			date: 'incurred_on',
			note: 'description',
			keys: {
				section: 'component.claim_section_claim',
				sectionHint: 'component.claim_section_claim_hint',
				date: 'component.incurred_on',
				proofHint: 'component.claim_section_proof_hint',
				note: 'component.claim_description',
				save: 'component.save_claim',
				create: 'component.create_claim'
			}
		},
		adhoc: {
			collection: 'adhoc_requests',
			catalogue: 'adhoc_catalogue',
			date: 'event_date',
			note: 'reason',
			keys: {
				section: 'component.adhoc_section_payment',
				sectionHint: 'component.adhoc_section_payment_hint',
				date: 'component.adhoc_event_date',
				proofHint: 'component.adhoc_section_proof_hint',
				note: 'component.adhoc_reason',
				save: 'component.save_adhoc',
				create: 'component.create_adhoc'
			}
		}
	} as const;

	let {
		view,
		family
	}: { view: RecordView<'claim_requests' | 'adhoc_requests'>; family: keyof typeof FAMILY } =
		$props();
	const spec = $derived(FAMILY[family]);
	const scope = hrCreateScope();
	const scopedEmploymentId = $derived(scope?.employmentId?.());
	const record = $derived(view.mode === 'update' ? view.record : null);
	// A create starts with the claw-back switch at No, and the person when the scope names them.
	const values = $derived(
		createValues(view, { as_adjustment_entry: false, employment_id: scopedEmploymentId })
	);
	/** An approved request stays editable until a payslip takes it: approval is workflow, the pin is settlement. */
	const lockReason = $derived(
		record == null
			? undefined
			: sourceLockRecordMetadata(
					sourceLock({
						existing: true,
						approvalId: Predicate.isString(record.approval_id) ? record.approval_id : null,
						dates: [],
						settledBy:
							record.payslip_id == null ? null : { period: String(record.pay_period ?? '') },
						datePassed: 'IS_NOT_A_LOCK'
					}),
					t
				)[0]?.reason
	);
	/** A form value is text: the employment it names is asserted here, where it enters. */
	const employmentOf = (value: unknown) =>
		Predicate.isString(value) && value !== '' ? (value as Id<'employments'>) : undefined;
	const text = (value: unknown) => (Predicate.isString(value) && value !== '' ? value : null);
</script>

<RecordShell
	of={spec.collection}
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
	{...lockReason == null ? {} : { icon: 'lucide:lock-keyhole', hint: lockReason }}
>
	<Form
		of={spec.collection}
		mode={view.mode}
		{...record == null ? {} : { id: record.id, record }}
		{values}
		submit={record ? t(spec.keys.save) : t(spec.keys.create)}
		onOutcome={openCreated(view)}
	>
		{#snippet children(form)}
			{@const employmentId = scopedEmploymentId ?? employmentOf(form.get('employment_id'))}
			<Stack gap="lg">
				<FormSection first title={t(spec.keys.section)} hint={t(spec.keys.sectionHint)}>
					<Grid gap="sm" minimum="compact">
						{#if scopedEmploymentId == null}
							<EmploymentField label={t('component.person')} companyId={scope?.companyId()} />
						{/if}
						<EligibleTypes
							catalogue={spec.catalogue}
							{employmentId}
							settingsCode={scope?.settingsCode()}
						>
							{#snippet children(where)}
								<Field name="catalogue_id" label={t('component.type')}>
									{#snippet editor(field)}
										<Picker
											of={spec.catalogue}
											label={['code', 'name']}
											{...where == null ? {} : { where }}
											orderBy={{ code: 'asc' }}
											value={text(field.value)}
											onChange={field.onChange}
											disabled={field.disabled}
										/>
									{/snippet}
								</Field>
							{/snippet}
						</EligibleTypes>
						<Field name="amount" label={t('component.entry_amount')} />
						<Field name={spec.date} label={t(spec.keys.date)} />
						{#if family === 'claim'}
							<Field name="due_on" label={t('component.claim_due_on')} />
						{/if}
						<Column span="all">
							<Field
								name="facts"
								label={t('component.request_facts')}
								help={t('component.request_facts_hint')}
							>
								{#snippet editor(field)}
									<RequestFactsField
										view={{
											mode: 'edit',
											name: field.name,
											value: field.value as never,
											disabled: field.disabled,
											onChange: field.onChange as never
										}}
										catalogue={spec.catalogue}
										catalogueId={text(form.get('catalogue_id'))}
									/>
								{/snippet}
							</Field>
						</Column>
					</Grid>
				</FormSection>

				<FormSection title={t('component.section_proof')} hint={t(spec.keys.proofHint)}>
					<Grid gap="sm" minimum="compact">
						<Field name="evidence_file" label={t('component.evidence_file')} />
						<Column span="all">
							<Field name={spec.note} label={t(spec.keys.note)} />
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
	</Form>
</RecordShell>
