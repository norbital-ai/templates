<script lang="ts">
	/**
	 * One expense claim: whose, against which component, how much, the day it was incurred and the
	 * receipt that evidences it.
	 *
	 * Every field on this form is a column of `claim_requests`. That is the whole point of the
	 * split: its predecessor drew five families through one arm picker and one polymorphic event
	 * renderer, so a person raising a taxi fare was first asked which of five business facts they
	 * meant, and every field they then filled in was one the type could not insist on. The refusals
	 * that policed those arms — a claim must state the day it was incurred, only a claim may carry
	 * evidence — are `notNull` and a column that exists nowhere else now, kept by the database on
	 * every path including the seed.
	 *
	 * There is no semantic rule attached either. Which components a claim may name used to be an
	 * `entry_kind: CLAIM` clause over one merged catalogue; the picker now reads `claim_catalogue`,
	 * a table that holds nothing else. A choice the form never presents is a refusal that never has
	 * to be written, in the form or in the hook — and a table that cannot hold the wrong row is a
	 * clause that never has to be written either.
	 *
	 * Self-service opens this same form. `employment_id` is prefilled and hidden when the create
	 * scope names the person, because an employee raising their own claim is not choosing whose it
	 * is — the same arrangement `leave_entries` uses.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { RepresentationProps } from './$types.js';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import { formatCalendarDate, formatNumeric } from '../../lib/ui/display-formatters.js';
	import {
		employmentRelationOptions,
		hrCreateScope,
		inForceCatalogue
	} from '../../lib/ui/create-scope.js';

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
	 * The capture, which is one junction lookup rather than a walk through payslip and run.
	 *
	 * It is read for the lock and for nothing else — the badge `sourceLockRecordMetadata` produces
	 * is the one statement that payroll has taken this row, and it is the same badge on leave
	 * requests and loan repayments. An approved claim stays editable until the capture exists:
	 * approval is workflow, consumption is settlement.
	 */
	const captureQuery = $derived(
		record
			? client.db.payslip_claim_request_inputs.findFirst({
					where: { claim_request_id: { eq: record.id } },
					columns: { period: true }
				})
			: null
	);
	const settledBy = $derived(
		captureQuery?.current ? { period: captureQuery.current.period } : null
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
		{#snippet children({ Field })}
			<Grid gap="md" minimum="compact">
				{#if scopedEmploymentId != null}
					<Field name="employment_id" hidden />
				{:else}
					<Field
						name="employment_id"
						label={t('component.person')}
						relationOptions={employmentRelationOptions(scopedCompanyId)}
					/>
				{/if}
				<Field
					name="claim_catalogue_id"
					label={t('component.catalogue_component')}
					relationOptions={{
						label: (component) => String(component.code ?? '') || '—',
						// The family is the table. Narrowing to it used to be an `entry_kind` clause on one
						// merged catalogue; the only condition left is the version of this entity's lineage in
						// force today.
						where: { ...inForceCatalogue('claim_catalogue_settings', scopedSettingsCode) },
						orderBy: { code: 'asc' },
						limit: 500
					}}
				/>
				<Field name="amount" label={t('component.entry_amount')} />
				<Field name="incurred_on" label={t('component.incurred_on')} />
				<Field name="evidence_file" label={t('component.evidence_file')} />
				<Field name="pay_period" label={t('component.pay_period_override')} />
				<!--
					The direction, and the line it corrects. The catalogue row declares whether this component
					adds to pay or reduces it; ticking this settles this one entry the opposite way, which is
					what a correction is now — a claw-back of a transport claim is a transport claim with the
					tick, under the same component, on the same payslip line. `corrects_adjustment_id` is
					provenance only and never the direction: outputs are immutable, so an entry names the
					settled line it fixes and there is no chain to walk.
				-->
				<Field name="as_adjustment_entry" label={t('component.as_adjustment_entry')} />
				<Field name="corrects_adjustment_id" label={t('component.corrects_adjustment')} />
				<Column span="all">
					<Field name="description" label={t('component.claim_description')} />
				</Column>
			</Grid>
		{/snippet}
	</CollectionForm>
</RecordShell>
