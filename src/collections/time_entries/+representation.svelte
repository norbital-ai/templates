<script lang="ts">
	/**
	 * An attendance day belongs to one employment. The auto form asked for `employment_id` as an
	 * editable uuid; it is a relationship and reads as the employee number.
	 *
	 * Every field here is a recorded fact about presence. There is no overtime field: payroll derives
	 * premium work from these intervals, the effective schedule and the statutory day type.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid } from '@norbital-ai/ui/layout';
	import { RelationshipRenderer } from '@norbital-ai/ui/data-renderer/relationship';
	import DurationHoursRenderer from '../../lib/ui/duration-hours-renderer.svelte';
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
						source_collection: { eq: 'time_entries' },
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
					dates: [record.work_date],
					today: todayKey(),
					windows: payrollWindows(runsQuery?.current ?? []),
					settledBy,
					freezeWhenLive: false
				})
			: { kind: 'NONE' as const }
	);
	const locked = $derived(record != null && sourceLockBlocksWrite(lock));
	const lockKey = $derived(sourceLockI18nKey(lock));
</script>

{#if lockKey}
	<p class="mb-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-meta">
		{t(lockKey, sourceLockI18nParams(lock))}
	</p>
{/if}

<CollectionForm
	{client}
	collection="time_entries"
	defaultValues={record ?? undefined}
	disabled={locked}
	submitLabel={record ? t('component.save_attendance') : t('component.create_attendance')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Grid gap="md" minimum="panel">
			<Field
				name="employment_id"
				label={t('component.employment')}
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
			<Field name="work_date" label={t('component.day')} />
			<Field name="worked_intervals" label={t('component.worked_intervals')} />
			<Field
				name="break_minutes"
				label={t('component.unpaid_break_hours')}
				renderer={DurationHoursRenderer}
			/>
		</Grid>
	{/snippet}
</CollectionForm>
