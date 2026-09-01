<script lang="ts">
	/**
	 * A leave request is three core facts — who, which leave, and what happened — plus optional
	 * certificate evidence on time off.
	 *
	 * The auto form painted all twelve columns. `kind`, `from_date`, `to_date`, `days`,
	 * `half_day_start`, `half_day_end`, `reason` and `summary` are `generatedAlwaysAs` projections of
	 * `event` — the database computes them so the collection can be indexed, ordered, searched and
	 * listed — so offering them as form fields showed the same
	 * values a second time, in inputs the database will not accept a write on.
	 *
	 * They are omitted here, not deleted from the model. Each is read: the leave tables order and
	 * print `from_date`/`to_date`/`days`, the approval analytics remote filters on
	 * `kind`, the scheduling board marks half days from `half_day_start`/`half_day_end`, `reason` and
	 * `summary` carry the row's search text, and the `(employment_id, leave_type_id, from_date)`
	 * index is built on three of them. The event is the source; they are its shadow.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import type { CollectionFormValidation } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { Effect, Option, Schema } from 'effect';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';
	import {
		certificatePolicyIssues,
		certificatePolicyMismatchMessage
	} from './certificate-policy.js';
	import { getContext } from 'svelte';
	import {
		LEAVE_REQUEST_CREATE_SCOPE,
		type LeaveRequestCreateScope
	} from '../../lib/ui/leave-request-create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = getContext<LeaveRequestCreateScope | undefined>(LEAVE_REQUEST_CREATE_SCOPE);
	const scopedEmploymentId = $derived(createScope?.employmentId());
	const scopedCompanyId = $derived(createScope?.companyId());
	const formValues = $derived(
		record ?? (scopedEmploymentId ? { employment_id: scopedEmploymentId } : undefined)
	);

	/**
	 * The settlement lock, read per record.
	 *
	 * The screen and the write hook compute the same lock from the same inputs — that is the whole
	 * contract of `lib/scheduling/lock.ts` — so this query is the screen's half of the stored claim.
	 * Without it the panel would say a record is editable right up until the hook refused it.
	 *
	 * Nothing else is asked. An existing leave request is held by the claim and by nothing else:
	 * approval and passed dates are not locks on this collection any more (the owner's one-lock
	 * rule), and the window keeps only its create-side job — a *new* range may not touch days a
	 * paid run already priced — which this panel never performs. See `assertLeaveSourceUnlocked` in
	 * `leave_requests/+hooks.ts`.
	 */
	const settlementQuery = $derived(
		record
			? client.db.payslip_leave_request_inputs.findFirst({
					where: { leave_request_id: { eq: record.id } },
					columns: { period: true }
				})
			: null
	);
	const settledBy = $derived(
		settlementQuery?.current ? { period: settlementQuery.current.period } : null
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
	const LeaveEventKindSchema = Schema.Struct({ kind: Schema.String });
	const decodeLeaveEventKind = Schema.decodeUnknownOption(LeaveEventKindSchema);

	/** The browser and the write hook enforce the same arm rule for the ordinary file column. */
	const validation = {
		semantic: (values) => {
			const event = Option.getOrNull(decodeLeaveEventKind(values.event));
			return Effect.succeed(
				certificatePolicyIssues({
					eventKind: event?.kind ?? null,
					certificateFile: values.certificate_file
				}).map((message) => ({
					message: certificatePolicyMismatchMessage([message]),
					path: ['certificate_file']
				}))
			);
		}
	} satisfies CollectionFormValidation;
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/__bolt/request/api/template-seed-assets/hr-payroll/record-media/leave_requests-banner.svg"
	/>
</svelte:head>

<CollectionForm
	{client}
	collection="leave_requests"
	defaultValues={formValues}
	{recordMetadata}
	{validation}
	submitLabel={record ? t('component.save_leave') : t('component.submit_leave')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			{#if createScope == null}
				<Field
					name="employment_id"
					label={t('component.person')}
					relationOptions={{
						label: (employment) =>
							employment.employee_number != null && employment.employee_number !== ''
								? String(employment.employee_number)
								: '—',
						orderBy: { employee_number: 'asc' },
						limit: 1000
					}}
				/>
			{:else}
				<Field name="employment_id" hidden />
			{/if}
			<Field
				name="leave_type_id"
				label={t('component.leave_type')}
				relationOptions={{
					label: (leaveType) =>
						[leaveType.code, leaveType.name]
							.filter((part) => part != null && part !== '')
							.join(' · ') || '—',
					where: scopedCompanyId ? { company_id: { eq: scopedCompanyId } } : undefined,
					orderBy: { code: 'asc' },
					limit: 500
				}}
			/>
			<Column span="all"><Field name="event" label={t('component.what_happened')} /></Column>
			<Column span="all"
				><Field name="certificate_file" label={t('component.certificate')} /></Column
			>
		</Grid>
	{/snippet}
</CollectionForm>
