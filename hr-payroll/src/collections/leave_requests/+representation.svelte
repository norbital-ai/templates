<script lang="ts">
	/**
	 * A leave request is three facts: who, which leave, and what happened.
	 *
	 * The auto form painted all twelve columns. `kind`, `from_date`, `to_date`, `days`,
	 * `half_day_start`, `half_day_end`, `reason`, `certificate_file` and `summary` are every one of
	 * them `generatedAlwaysAs` projections of `event` — the database computes them so the collection
	 * can be indexed, ordered, searched and listed — so offering them as form fields showed the same
	 * values a second time, in inputs the database will not accept a write on.
	 *
	 * They are omitted here, not deleted from the model. Each is read: the leave tables order and
	 * print `from_date`/`to_date`/`days`/`certificate_file`, the approval analytics remote filters on
	 * `kind`, the scheduling board marks half days from `half_day_start`/`half_day_end`, `reason` and
	 * `summary` carry the row's search text, and the `(employment_id, leave_type_id, from_date)`
	 * index is built on three of them. The event is the source; they are its shadow.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid } from '@norbital-ai/ui/layout';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

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
			? client.db.payslip_sources.findFirst({
					where: { source: { eq: { kind: 'LEAVE_REQUEST', id: record.id } } },
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
	defaultValues={record ?? undefined}
	{recordMetadata}
	submitLabel={record ? t('component.save_leave') : t('component.submit_leave')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
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
			<Field
				name="leave_type_id"
				label={t('component.leave_type')}
				relationOptions={{
					label: (leaveType) =>
						[leaveType.code, leaveType.name]
							.filter((part) => part != null && part !== '')
							.join(' · ') || '—',
					orderBy: { code: 'asc' },
					limit: 500
				}}
			/>
			<Column span="all"><Field name="event" label={t('component.what_happened')} /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
