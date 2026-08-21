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
	 * Nothing else is asked. Attendance records are held by the claim and by nothing else: a passed
	 * date is not a lock on this collection, and a paid window governs days that have no record,
	 * never a record that exists — see `assertRecordNotClaimed` in `time_entries/+hooks.ts`.
	 */
	const settlementQuery = $derived(
		record
			? client.db.payslip_sources.findFirst({
					where: { time_entry_id: { eq: record.norbital_id } },
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
					dates: [],
					settledBy,
					datePassed: 'IS_NOT_A_LOCK'
				})
			: { kind: 'NONE' as const }
	);
	const recordMetadata = $derived(sourceLockRecordMetadata(lock, t));
</script>

<CollectionForm
	{client}
	collection="time_entries"
	defaultValues={record ?? undefined}
	{recordMetadata}
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
