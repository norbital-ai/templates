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
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import { todayKey } from '../../lib/ui/calendar.js';
	import {
		payrollWindows,
		sourceLock,
		sourceLockBlocksWrite,
		sourceLockI18nKey,
		sourceLockI18nParams
	} from '../../lib/scheduling/lock.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	const employmentQuery = $derived(
		record
			? client.db.employments.findFirst({
					where: { norbital_id: { eq: record.employment_id } },
					columns: { company_id: true }
				})
			: null
	);
	const runsQuery = $derived(
		employmentQuery?.current?.company_id
			? client.db.payroll_runs.findMany({
					where: { company_id: { eq: employmentQuery.current.company_id } },
					columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
					limit: 500
				})
			: null
	);
	/**
	 * The settlement lock, read per record.
	 *
	 * The screen and the write hook compute the same lock from the same inputs — that is the whole
	 * contract of `lib/scheduling/lock.ts` — so this query is the screen's half of the stored claim.
	 * Without it the panel would say a record is editable right up until the hook refused it.
	 */
	const settlementQuery = $derived(
		record
			? client.db.payroll_settlements.findFirst({
					where: {
						source_collection: { eq: 'leave_requests' },
						source_record_id: { eq: record.norbital_id }
					},
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
					approvalId: record.norbital_approval_id,
					dates: [record.from_date, record.to_date],
					today: todayKey(),
					windows: payrollWindows(runsQuery?.current ?? []),
					settledBy,
					freezeWhenLive: true
				})
			: { kind: 'NONE' as const }
	);
	const locked = $derived(record != null && sourceLockBlocksWrite(lock));
	const lockKey = $derived(sourceLockI18nKey(lock));
</script>

<svelte:head>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/hr-payroll/record-media/leave_requests-banner.svg"
	/>
</svelte:head>

{#if lockKey}
	<p
		class="mb-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
	>
		{t(lockKey, sourceLockI18nParams(lock))}
	</p>
{/if}

<CollectionForm
	{client}
	collection="leave_requests"
	defaultValues={record ?? undefined}
	disabled={locked}
	submitLabel={record ? t('component.save_leave') : t('component.submit_leave')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			<Field
				name="employment_id"
				label={t('component.person')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'employments',
					options: {
						label: (employment) =>
							employment.employee_number != null && employment.employee_number !== ''
								? String(employment.employee_number)
								: '—',
						orderBy: { employee_number: 'asc' },
						limit: 1000
					}
				}}
			/>
			<Field
				name="leave_type_id"
				label={t('component.leave_type')}
				renderer={RelationshipRenderer}
				rendererProps={{
					target: 'leave_types',
					options: {
						label: (leaveType) =>
							[leaveType.code, leaveType.name]
								.filter((part) => part != null && part !== '')
								.join(' · ') || '—',
						orderBy: { code: 'asc' },
						limit: 500
					}
				}}
			/>
			<Column span="all"><Field name="event" label={t('component.what_happened')} /></Column>
		</Grid>
	{/snippet}
</CollectionForm>
