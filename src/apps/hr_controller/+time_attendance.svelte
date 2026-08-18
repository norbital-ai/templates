<script lang="ts">
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import AppHeaderActions from '@norbital-ai/bolt/client/app-header-actions';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { WorkspaceRow } from '$bolt/types.js';
	import { Display, type ChartDisplaySpec } from '@norbital-ai/ui/chart';
	import { Tabs, type TabConfig } from '@norbital-ai/ui/tabs';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { Combobox } from '@norbital-ai/ui/combobox';
	import { Cover, Grid, Inline, Stack } from '@norbital-ai/ui/layout';
	import {
		shiftDayKey,
		startOfIsoWeekDate,
		todayKey,
		todayInstant
	} from '../../lib/ui/calendar.js';
	import {
		formatCalendarDate,
		formatDurationHours,
		formatInstant
	} from '../../lib/ui/display-formatters.js';
	import { runWorkbookImport } from '../../lib/ui/workbook-import.js';
	import { timeEntryImportPayload } from '../../collections/time_entries/lib/import-workbook.js';
	import { attendanceBoundary, attendanceState, workedMinutes } from '../../lib/attendance.js';
	import {
		payrollWindows,
		sourceLock,
		sourceLockFrozen,
		sourceLockReason
	} from '../../lib/scheduling/lock.js';

	const { t } = useI18n<TenantI18nKeys>();

	let requestedCompanyId = $state<string | null>(null);
	type EntryWindow = '8w' | '6m' | '1y' | 'all';
	let entryWindow = $state<EntryWindow>('8w');
	const today = todayKey();
	const currentWeek = startOfIsoWeekDate(today) ?? today;
	const trendStart = shiftDayKey(currentWeek, -49);
	const activeRange = { effective_range: { contains_date: todayInstant() } } as const;
	const entryWindowStart = $derived.by(() => {
		switch (entryWindow) {
			case '8w':
				return trendStart;
			case '6m':
				return shiftDayKey(today, -182);
			case '1y':
				return shiftDayKey(today, -365);
			case 'all':
				return null;
		}
	});
	const entryWindowOptions = $derived([
		{ value: '8w', label: t('app.time_attendance.range_8w') },
		{ value: '6m', label: t('app.time_attendance.range_6m') },
		{ value: '1y', label: t('app.time_attendance.range_1y') },
		{ value: 'all', label: t('app.time_attendance.range_all') }
	]);

	const companiesQuery = client.db.companies.findMany({
		where: { norbital_approval_id: { isNull: true }, ...activeRange },
		orderBy: { name: 'asc' },
		limit: 500
	});
	const companies = $derived(companiesQuery.current ?? []);
	const companyOptions = $derived(
		companies.map((c) => ({
			value: c.norbital_id,
			label: c.name,
			search_term: `${c.name} ${c.registration_number ?? ''}`
		}))
	);
	const selectedCompanyId = $derived(
		companies.some((company) => company.norbital_id === requestedCompanyId)
			? requestedCompanyId
			: (companies[0]?.norbital_id ?? null)
	);
	const payrollRunsQuery = $derived(
		selectedCompanyId == null
			? null
			: client.db.payroll_runs.findMany({
					where: { company_id: { eq: selectedCompanyId } },
					columns: { period: true, lifecycle: true, attendance_from: true, attendance_to: true },
					limit: 500
				})
	);
	const payrollLockWindows = $derived(payrollWindows(payrollRunsQuery?.current ?? []));

	function attendanceRowLock(row: WorkspaceRow<'time_entries'>) {
		return sourceLock({
			existing: true,
			approvalId: row.norbital_approval_id,
			dates: [row.work_date],
			today,
			windows: payrollLockWindows,
			freezeWhenLive: false
		});
	}

	const attendanceSummaryQuery = $derived(
		selectedCompanyId == null
			? null
			: client.invoke.attendance_summary({
					company_id: selectedCompanyId,
					from: trendStart,
					to: today
				})
	);
	const attendanceTrend = $derived(attendanceSummaryQuery?.current ?? []);
	const attendanceChart = $derived({
		kind: 'line',
		loading: attendanceSummaryQuery?.loading ?? false,
		title: t('app.time_attendance.chart_title'),
		description: t('app.time_attendance.chart_description'),
		data: attendanceTrend,
		xKey: 'week',
		series: ['exceptionRate'],
		config: {
			exceptionRate: {
				label: t('app.time_attendance.chart_exception_rate'),
				color: 'var(--color-destructive)'
			}
		},
		valueFormat: { style: 'percent', maximumFractionDigits: 1 },
		curve: 'linear'
	} satisfies ChartDisplaySpec);

	type TimeEntryRow = WorkspaceRow<'time_entries'> & {
		readonly time_entry_employment?: Pick<WorkspaceRow<'employments'>, 'employee_number'> | null;
	};

	function employmentLabel(row: TimeEntryRow): string {
		return row.time_entry_employment?.employee_number ?? '—';
	}

	function intervalBoundary(
		intervals: WorkspaceRow<'time_entries'>['worked_intervals'],
		boundary: 'FIRST' | 'LAST'
	): string {
		return formatInstant(attendanceBoundary(intervals, boundary));
	}

	function workedHours(row: WorkspaceRow<'time_entries'>): string {
		return formatDurationHours(workedMinutes(row.worked_intervals, row.break_minutes), t);
	}

	function stateLabel(intervals: WorkspaceRow<'time_entries'>['worked_intervals']): string {
		const state = attendanceState(intervals);
		return state === 'COMPLETE'
			? t('component.attendance_complete')
			: state === 'OPEN'
				? t('component.attendance_open')
				: t('component.attendance_invalid');
	}
</script>

<svelte:head>
	<title>Time &amp; Attendance</title>
	<meta
		name="description"
		content="Review missing punches, schedule mismatches, time entries, and overtime"
	/>
	<meta name="bolt:icon" content="lucide:clock-3" />
	<meta
		name="bolt:thumbnail"
		content="/api/template-seed-assets/hr-payroll/app-media/time_attendance-banner.webp"
	/>
	<meta
		name="bolt:banner"
		content="/api/template-seed-assets/hr-payroll/app-media/time_attendance-banner.webp"
	/>
</svelte:head>

{#snippet companyScopeActions()}
	<Inline gap="sm">
		<Combobox
			ariaLabel={t('component.legal_entity')}
			options={companyOptions}
			value={selectedCompanyId}
			onValueChange={(value) => {
				if (typeof value === 'string') {
					requestedCompanyId = value;
					return;
				}
				requestedCompanyId = companies[0]?.norbital_id ?? null;
			}}
			emptyPlaceholder={t('component.select_legal_entity')}
			searchPlaceholder={t('component.search_companies')}
			clientConfig={{
				isLoading: companiesQuery.loading,
				error: companiesQuery.error?.message ?? null
			}}
			class="min-w-[16rem]"
		/>
		<Combobox
			ariaLabel={t('app.time_attendance.range_label')}
			options={entryWindowOptions}
			value={entryWindow}
			onValueChange={(value) => {
				if (value === '8w' || value === '6m' || value === '1y' || value === 'all') {
					entryWindow = value;
				}
			}}
			searchable={false}
			class="min-w-[10rem]"
		/>
	</Inline>
{/snippet}

{#snippet overview()}
	<Grid gap="xl" minimum="panel">
		<Stack gap="md">
			<div>
				<h2 class="text-lg font-semibold">{t('app.time_attendance.attendance_readiness')}</h2>
				<p class="text-sm text-muted-foreground">
					{t('app.time_attendance.attendance_readiness_description')}
				</p>
			</div>
		</Stack>
		{#if selectedCompanyId == null}
			<p class="text-sm text-muted-foreground">
				{t('app.time_attendance.empty_overview')}
			</p>
		{:else}
			<Display
				spec={attendanceChart}
				class="min-h-[18rem] rounded-lg border bg-card p-4 shadow-card"
			/>
		{/if}
	</Grid>
{/snippet}

{#snippet entries()}
	{#if selectedCompanyId == null}
		<p class="text-sm text-muted-foreground">{t('app.time_attendance.empty_entries')}</p>
	{:else}
		{#key selectedCompanyId}
			<CollectionTable
				{client}
				collection="time_entries"
				view={`hr_controller:time_attendance:entries:${selectedCompanyId}`}
				isRowLocked={(row) => sourceLockFrozen(attendanceRowLock(row))}
				rowLockReason={(row) => sourceLockReason(attendanceRowLock(row), t)}
				query={{
					where: {
						time_entry_employment: {
							norbital_approval_id: { isNull: true },
							company_id: { eq: selectedCompanyId }
						},
						...(entryWindowStart ? { work_date: { gte: entryWindowStart, lte: today } } : {})
					},
					orderBy: { work_date: 'desc' },
					with: {
						time_entry_employment: { columns: { employee_number: true } }
					}
				}}
				importPipelines={[
					{
						id: 'time-entry-workbook',
						label: t('app.time_attendance.import_pipeline'),
						description: t('app.time_attendance.import_pipeline_description'),
						icon: 'lucide:clock-arrow-up',
						run: async () => {
							await runWorkbookImport(
								{
									collectionName: 'time_entries',
									recordLabel: t('component.time_entries'),
									buildPayload: timeEntryImportPayload
								},
								t
							);
						}
					}
				]}
			>
				{#snippet columns({ Column })}
					<Column
						name="work_date"
						label={t('component.work_date')}
						card="title"
						render={({ row }) => formatCalendarDate(row.work_date)}
					/>
					<Column
						name="employment_id"
						label={t('component.employment')}
						card="subtitle"
						render={({ row }) => employmentLabel(row)}
					/>
					<Column
						name="worked_intervals"
						label={t('component.clock_in')}
						render={({ row }) => intervalBoundary(row.worked_intervals, 'FIRST')}
					/>
					<Column
						name="worked_intervals"
						label={t('component.clock_out')}
						render={({ row }) => intervalBoundary(row.worked_intervals, 'LAST')}
					/>
					<Column
						name="break_minutes"
						label={t('app.time_attendance.break_hours')}
						render={({ row }) => formatDurationHours(row.break_minutes, t)}
					/>
					<Column
						name="worked_intervals"
						label={t('component.worked_hours')}
						render={({ row }) => workedHours(row)}
					/>
					<Column
						name="worked_intervals"
						label={t('component.state')}
						card="badge"
						render={({ row }) => stateLabel(row.worked_intervals)}
					/>
				{/snippet}
			</CollectionTable>
		{/key}
	{/if}
{/snippet}

<AppHeaderActions>
	{@render companyScopeActions()}
</AppHeaderActions>

<Cover>
	<Tabs
		animate={false}
		config={[
			{
				name: 'overview',
				label: t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				content: overview
			},
			{
				name: 'entries',
				label: t('app.time_attendance.tab_entries'),
				icon: 'lucide:clock-3',
				content: entries
			}
		] satisfies TabConfig[]}
	/>
</Cover>
