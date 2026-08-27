<script lang="ts">
	/**
	 * One person-day: what was planned for it, and what actually happened on it.
	 *
	 * The two halves were two forms, on two collections, asking for the same employment and the same
	 * date. They are two sections of one form now, and the order is the order the day happens in —
	 * the plan is made first and the clock answers it.
	 *
	 * There is no overtime field on either side. Payroll derives premium work from the actual
	 * intervals, the effective schedule and the statutory day type; a form cannot assert it.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import DurationHoursRenderer from '../../lib/ui/duration-hours-renderer.svelte';
	import { sourceLock, sourceLockRecordMetadata } from '../../lib/scheduling/lock.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();

	/**
	 * The settlement lock, read per record.
	 *
	 * The screen and the write hook compute the same lock from the same inputs — that is the whole
	 * contract of `lib/scheduling/lock.ts` — so this query is the screen's half of the stored claim.
	 * Without it the panel would say a day is editable right up until the hook refused it.
	 *
	 * It reads `payslip_adjustments`, which is what `payslip_sources` became: a run that read this
	 * day and priced it at nothing still wrote a row, and that zero-amount row is the claim.
	 * `settlementLedgerGrants()` is why an ordinary rank may read it at all — see
	 * `src/lib/policy_grants.ts`; the grant exposes the claim and never the amounts.
	 *
	 * Nothing else is asked. A person-day is held by the claim and by nothing else: a passed date is
	 * not a lock on this collection, and a paid window governs days that have no record, never a
	 * record that exists.
	 */
	const settlementQuery = $derived(
		record
			? client.db.payslip_adjustments.findFirst({
					where: { source: { eq: { kind: 'WORK_DAY', id: record.id } } },
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

<CollectionForm
	{client}
	collection="work_days"
	defaultValues={record ?? undefined}
	{recordMetadata}
	submitLabel={record ? t('component.save_work_day') : t('component.create_work_day')}
	onAfterSubmit={record ? undefined : close}
>
	{#snippet children({ Field })}
		<Field name="planned_origin" hidden />
		<Stack gap="lg">
			<Grid gap="md" minimum="panel">
				<Field
					name="employment_id"
					label={t('component.employment')}
					relationOptions={{
						label: (employment) =>
							employment.employee_number != null && employment.employee_number !== ''
								? String(employment.employee_number)
								: '—',
						orderBy: { employee_number: 'asc' },
						limit: 1000
					}}
				/>
				<Field name="work_date" label={t('component.day')} />
			</Grid>

			<Stack as="section" gap="sm" aria-labelledby="work-day-planned-heading">
				<h3 id="work-day-planned-heading" class="text-sm font-semibold">
					{t('component.work_day_planned')}
				</h3>
				<p class="text-meta">{t('component.work_day_planned_description')}</p>
				<Grid gap="md" minimum="panel">
					<Field
						name="shift_definition_id"
						label={t('component.shift')}
						relationOptions={{
							label: (shift) =>
								[shift.code, shift.name]
									.filter((part) => part != null && part !== '')
									.join(' · ') || '—',
							orderBy: { code: 'asc' },
							limit: 500
						}}
					/>
					<Field
						name="roster_id"
						label={t('component.drafted_month')}
						relationOptions={{
							label: (roster) =>
								roster.month != null && roster.month !== '' ? String(roster.month) : '—',
							orderBy: { month: 'desc' },
							limit: 500
						}}
					/>
					<Field name="assignment_code" label={t('component.source_roster_token')} />
					<Column span="all"
						><Field name="planned_note" label={t('component.planned_note')} /></Column
					>
				</Grid>
			</Stack>

			<Stack as="section" gap="sm" aria-labelledby="work-day-actual-heading">
				<h3 id="work-day-actual-heading" class="text-sm font-semibold">
					{t('component.work_day_actual')}
				</h3>
				<p class="text-meta">{t('component.work_day_actual_description')}</p>
				<Grid gap="md" minimum="panel">
					<Column span="all">
						<Field name="worked_intervals" label={t('component.worked_intervals')} />
					</Column>
					<Field
						name="break_minutes"
						label={t('component.unpaid_break_hours')}
						renderer={DurationHoursRenderer}
					/>
				</Grid>
			</Stack>
		</Stack>
	{/snippet}
</CollectionForm>
