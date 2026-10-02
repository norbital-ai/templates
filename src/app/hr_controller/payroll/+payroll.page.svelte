<script lang="ts">
	/**
	 * Payroll for one legal entity. Runs: one year-filtered table of recorded calculations and their payslip
	 * totals; a run opens on its payslips, and selected runs drive exports. Obligations: the entity's duty ledger, filings and
	 * remittances and the FACT_OWED reminders alike, each completed on its own record.
	 */
	import { t, type MessageKey } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Toaster } from 'svelte-sonner';
	import { AppShell, Cluster, Scroll, Stack } from '@norbital-ai/ui/layout';
	import type { Live, Id } from '@norbital-ai/bolt';
	import { Badge, Button, Combobox, EmptyState, Table, Tabs, openRecord } from '@norbital-ai/ui';
	import { payDateFor, todayKey } from '../../../lib/ui/calendar.js';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import ScopeGate from '../../../lib/ui/ScopeGate.svelte';
	import Loading from '../../../lib/ui/Loading.svelte';
	import { companyScope, employmentNames } from '../../../lib/ui/company-scope.svelte.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';
	import { payCycles } from '../../../lib/pay-cycles.js';
	import { daysLate, FACT_OWED, obligationStatus } from '../../../lib/obligations/materialise.js';
	import {
		collectPayslipPages,
		type PayslipExportFile
	} from '../../../lib/ui/payslip-export-pages.js';
	import OffCycleRun from './off-cycle-run.svelte';
	import { getAllContexts, setContext } from 'svelte';
	import { watch } from 'runed';
	import { HR_CREATE_SCOPE } from '../../../lib/ui/create-scope.js';
	import { payrollCycleScope } from '../../../lib/ui/payroll-cycle-scope.js';
	import { readRange } from '../../../lib/payroll/run/effective.js';
	import { dateKey } from '../../../lib/iso-day.js';

	let pdfFiles = $state<readonly PayslipExportFile[]>([]);
	let pdfBusy = $state(false);
	let pdfError = $state<string | null>(null);
	// The shell serves runsLive (§3.5); this member is absent from the generated PageBolt type.
	const runClient = bolt as typeof bolt & {
		runs(
			automation: string,
			options: { where: { id: { eq: string } }; limit: number }
		): Live<{
			rows: {
				status: string;
				result?: unknown;
				error?: { message?: string; code: string } | null;
			}[];
		}>;
	};
	async function exportPdfs(ids: Id<'payroll_runs'>[]) {
		if (pdfBusy) return;
		pdfBusy = true;
		pdfError = null;
		pdfFiles = [];
		try {
			await collectPayslipPages(
				async (payslip_offset) => {
					const handle = bolt.start('payroll_export', {
						ids,
						kind: 'payslip-pdfs',
						payslip_offset
					});
					const admitted = await handle;
					if (admitted.kind !== 'committed')
						throw new Error(admitted.kind === 'refused' ? admitted.message : t('component.error'));
					const live = runClient.runs('payroll_export', {
						where: { id: { eq: handle.id } },
						limit: 1
					});
					return new Promise<unknown>((resolve, reject) => {
						const stop = live.subscribe((page) =>
							queueMicrotask(() => {
								if (live.error != null) {
									stop();
									reject(new Error(live.error.message));
									return;
								}
								const run = page?.rows[0];
								if (run?.status === 'succeeded') {
									stop();
									resolve(run.result);
								} else if (run != null && ['failed', 'stopped', 'skipped'].includes(run.status)) {
									stop();
									reject(new Error(run.error?.message ?? run.error?.code ?? t('component.error')));
								}
							})
						);
					});
				},
				(files) => {
					pdfFiles = files;
				}
			);
		} catch (error) {
			pdfError = error instanceof Error ? error.message : t('component.error');
		} finally {
			pdfBusy = false;
		}
	}

	const scope = companyScope();
	const today = String(todayKey());
	const personName = employmentNames(() => scope.id);
	const runs = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payroll_runs', {
					where: { company_id: { eq: scope.id } },
					select: { company_id: true, period: true, kind: true, sequence: true, pay_date: true },
					all: true
				})
	);
	// payment is a fact of the slips: a run reads its progress rather than declaring a state
	const slips = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payslips', {
					where: { payroll_run_id: { is: { company_id: { eq: scope.id } } } },
					select: {
						payroll_run_id: true,
						employment_id: true,
						status: true,
						gross: true,
						net: true,
						employer_cost: true
					},
					all: true
				})
	);
	const reminders = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('obligation_instances', {
					where: {
						company_id: { eq: scope.id },
						duty_code: { eq: FACT_OWED },
						state: { eq: 'OPEN' }
					},
					select: { due_on: true },
					all: true
				})
	);
	const paid = $derived(
		Map.groupBy(slips.current ?? [], (slip) => slip.payroll_run_id) as Map<
			string,
			{ status: unknown }[]
		>
	);
	const runCycles = $derived(
		payCycles(
			runs.current ?? [],
			(slips.current ?? []).map((slip) => ({
				...slip,
				gross: decodeNumber(slip.gross),
				net: decodeNumber(slip.net),
				employer_cost: decodeNumber(slip.employer_cost)
			}))
		)
	);
	const runRows = $derived(
		runCycles.flatMap((cycle) =>
			cycle.runs.map(({ run, totals }) => {
				const own = paid.get(run.id) ?? [];
				const paidCount = own.filter((slip) => slip.status === 'PAID').length;
				const status =
					own.length === 0
						? 'EMPTY'
						: paidCount === own.length
							? 'PAID'
							: own.some((slip) => slip.status === 'ON_HOLD')
								? 'ON_HOLD'
								: paidCount > 0
									? 'PART_PAID'
									: 'UNPAID';
				return {
					id: run.id,
					period: run.period,
					kind: run.kind ?? 'REGULAR',
					pay_date: run.pay_date,
					status,
					headcount: totals.headcount,
					gross: totals.gross,
					net: totals.net,
					employer_cost: totals.employerCost,
					paid: paidCount,
					slips: own.length
				};
			})
		)
	);
	const employments = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('employments', {
					where: { company_id: { eq: scope.id } },
					select: { effective_range: true },
					all: true
				})
	);
	const firstWork = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('work_days', {
					where: {
						employment_id: { is: { company_id: { eq: scope.id } } },
						approval_id: { isNull: true }
					},
					select: { work_date: true },
					orderBy: { work_date: 'asc' },
					limit: 1
				})
	);
	const firstRoster = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('rosters', {
					where: {
						employment_id: { is: { company_id: { eq: scope.id } } },
						approval_id: { isNull: true }
					},
					select: { period: true },
					orderBy: { period: 'asc' },
					limit: 1
				})
	);
	const cycleScope = $derived.by(() => {
		const starts = (employments.current ?? [])
			.flatMap((row) => {
				const start = readRange(row.effective_range)?.start;
				return start == null ? [] : [dateKey(start)];
			})
			.toSorted();
		const companyStart = readRange(scope.company?.effective_range)?.start;
		const commencement =
			[starts[0], companyStart == null ? undefined : dateKey(companyStart)]
				.filter((value): value is string => value != null)
				.toSorted()
				.at(-1) ?? today;
		const evidenceDate = [
			firstWork.current?.[0]?.work_date == null
				? undefined
				: dateKey(firstWork.current[0].work_date),
			firstRoster.current?.[0]?.period == null ? undefined : `${firstRoster.current[0].period}-01`
		]
			.filter((value): value is string => value != null)
			.toSorted()[0];
		return payrollCycleScope({
			today,
			frequency: scope.company?.pay_frequency ?? 'MONTHLY',
			commencement,
			...(evidenceDate == null ? {} : { evidenceDate }),
			runs: runs.current ?? [],
			slips: slips.current ?? []
		});
	});
	let selectedCycle = $state<{ company: string | null; period: string }>({
		company: null,
		period: ''
	});
	watch(
		() =>
			scope.id != null &&
			runs.current !== undefined &&
			slips.current !== undefined &&
			employments.current !== undefined &&
			firstWork.current !== undefined &&
			firstRoster.current !== undefined
				? scope.id
				: null,
		(id) => {
			if (id != null && selectedCycle.company !== id)
				selectedCycle = { company: id, period: cycleScope.next };
		}
	);
	const creationPeriod = $derived(
		selectedCycle.company === scope.id && selectedCycle.period !== ''
			? selectedCycle.period
			: cycleScope.next
	);
	const year = $derived(creationPeriod.slice(0, 4));
	const visibleRuns = $derived(runRows.filter((run) => run.period.startsWith(`${year}-`)));
	setContext(HR_CREATE_SCOPE, {
		companyId: () => scope.id ?? undefined,
		settingsCode: () => scope.company?.settings_code,
		payrollPeriod: () => cycleScope.available.find((period) => period >= creationPeriod)
	});
	const createContexts = getAllContexts();
	const remindersBeforeRun = $derived(
		runCycles.find((cycle) => cycle.period === creationPeriod)?.regular
			? 0
			: (reminders.current ?? []).filter(
					(row) => String(row.due_on) <= payDateFor(creationPeriod, scope.company?.pay_frequency)
				).length
	);

	let tab = $state('runs');
	let remindersOnly = $state(false);
	const showReminders = () => {
		remindersOnly = true;
		tab = 'obligations';
	};
	let adhocPeriod = $state<string | null>(null);
	const runPayroll = () => openRecord('payroll_runs', 'new', createContexts);

	const KIND: Record<string, MessageKey> = {
		REGULAR: 'models.payroll_runs.fields.kind.REGULAR',
		OFF_CYCLE: 'models.payroll_runs.fields.kind.OFF_CYCLE',
		EARLY: 'models.payroll_runs.fields.kind.EARLY',
		FINAL: 'models.payroll_runs.fields.kind.FINAL',
		CORRECTION: 'models.payroll_runs.fields.kind.CORRECTION'
	};
	const EXPORTS = [
		['bank-files', 'app.payroll.export_bank_files'],
		['payslip-pdfs', 'app.payroll.export_payslip_pdfs'],
		['payroll-report-xlsx', 'app.payroll.export_workbook'],
		['catalogue-entries-xlsx', 'app.payroll.export_catalogue_entries'],
		['returns', 'app.payroll.export_returns']
	] as const;
	const STATUS: Record<ReturnType<typeof obligationStatus>, MessageKey> = {
		OPEN: 'app.payroll.obligation_open',
		LATE: 'app.payroll.obligation_late',
		FULFILLED: 'app.payroll.obligation_fulfilled',
		WAIVED: 'app.payroll.obligation_waived'
	};
	const BADGE = {
		OPEN: 'outline',
		LATE: 'destructive',
		FULFILLED: 'success',
		WAIVED: 'default'
	} as const;
	type Duty = {
		readonly duty_code: string;
		readonly state: string;
		readonly due_on: string;
		readonly fulfilled_on?: string | null;
		readonly subject_kind: string;
		readonly subject_id: string;
	};
</script>

{#snippet dayCell({ value }: { value: unknown })}{formatCalendarDate(value)}{/snippet}
{#snippet amountCell({ value }: { value: unknown })}
	<span class="tabular-nums">{formatNumeric(value)}</span>
{/snippet}
{#snippet kindCell({ row }: { row: { readonly [f: string]: unknown } })}
	{KIND[String(row.kind)] == null ? String(row.kind) : t(KIND[String(row.kind)]!)}
{/snippet}
{#snippet paymentCell({ row }: { row: { readonly status: string } })}
	<Badge variant={row.status === 'PAID' ? 'success' : 'outline'}>
		{row.status === 'PAID'
			? t('app.payroll.paid')
			: row.status === 'PART_PAID'
				? t('app.payroll.part_paid')
				: row.status === 'ON_HOLD'
					? t('app.payroll.on_hold')
					: row.status === 'EMPTY'
						? t('app.payroll.no_payslips')
						: t('app.payroll.unpaid')}
	</Badge>
{/snippet}
{#snippet paidCell({ row }: { row: { readonly paid: number; readonly slips: number } })}
	<span class="tabular-nums">{row.slips === 0 ? '—' : `${row.paid}/${row.slips}`}</span>
{/snippet}
{#snippet emptyRuns()}
	<EmptyState title={t('app.payroll.no_runs_year', { year })} />
{/snippet}

{#snippet runsTab()}
	{#if scope.id != null}
		{@const companyId = scope.id}
		<Stack gap="sm">
			<Cluster gap="sm">
				{#if remindersBeforeRun > 0}
					<Button size="sm" variant="link" onclick={showReminders}>
						{remindersBeforeRun === 1
							? t('app.payroll.reminders_before_run_one')
							: t('app.payroll.reminders_before_run_many', { count: remindersBeforeRun })}
					</Button>
				{/if}
			</Cluster>
			{#if runs.error != null || slips.error != null}
				<EmptyState title={runs.error ?? slips.error ?? ''} />
			{:else if runs.loading || slips.loading}
				<Loading />
			{:else}
				<Table
					of={visibleRuns}
					key={`runs-${companyId}-${year}`}
					empty={emptyRuns}
					toolbar={{
						title: false,
						filter: false,
						export: false,
						new: runPayroll,
						actions: [
							{
								action: 'payroll_runs.update',
								label: t('app.payroll.recalculate_unpaid'),
								description: t('app.payroll.recalculate_unpaid_help'),
								input: (ids: Id<'payroll_runs'>[]) => ({ target: ids[0]!, set: {} }),
								requiresSelection: true,
								disabled: (ids: Id<'payroll_runs'>[]) =>
									ids.length === 1 ? null : t('app.payroll.select_one_run')
							},
							...EXPORTS.map(([kind, label]) =>
								kind === 'payslip-pdfs'
									? {
											run: exportPdfs,
											label: t(label),
											requiresSelection: true as const,
											disabled: () => (pdfBusy ? t('app.payroll.export_payslip_pdfs') : null)
										}
									: {
											start: 'payroll_export' as const,
											input: (ids: Id<'payroll_runs'>[]) => ({ ids, kind }),
											label: t(label),
											requiresSelection: true as const
										}
							),
							{ run: () => (adhocPeriod = creationPeriod), label: t('app.payroll.new_adhoc_run') },
							{
								run: (ids: Id<'payroll_runs'>[]) => {
									const run = runRows.find((row) => row.id === ids[0]);
									if (run != null) adhocPeriod = run.period;
								},
								label: t('app.payroll.adhoc_in_selected_period'),
								requiresSelection: true as const,
								disabled: (ids: Id<'payroll_runs'>[]) =>
									ids.length === 1 ? null : t('app.payroll.select_one_run')
							}
						]
					}}
					actions={[
						{
							action: 'payroll_runs.delete',
							label: t('app.payroll.delete_run'),
							confirm: t('app.payroll.delete_run_confirm')
						}
					]}
					onOpen={(row) => openRecord('payroll_runs', row.id)}
					columns={[
						{ field: 'period', label: t('app.payroll.period') },
						{ field: 'kind', label: t('app.payroll.kind'), cell: kindCell },
						{ field: 'status', label: t('app.payroll.status'), cell: paymentCell },
						{ field: 'pay_date', label: t('app.payroll.pay_date'), cell: dayCell },
						{ field: 'headcount', label: t('app.payroll.headcount') },
						{ field: 'gross', label: t('component.gross'), cell: amountCell },
						{ field: 'net', label: t('component.net'), cell: amountCell },
						{ field: 'paid', label: t('app.payroll.paid'), cell: paidCell },
						{
							field: 'employer_cost',
							label: t('app.payroll.employer_cost'),
							cell: amountCell,
							hide: 'narrow'
						}
					]}
				/>
			{/if}
		</Stack>
		{#if adhocPeriod != null}
			{@const cycle = runCycles.find((row) => row.period === adhocPeriod)}
			<OffCycleRun
				bind:open={
					() => true,
					(next) => {
						if (!next) adhocPeriod = null;
					}
				}
				{companyId}
				settingsCode={scope.company?.settings_code ?? ''}
				period={adhocPeriod}
				cycleRuns={cycle?.runs.map(({ run }) => run) ?? []}
				cycleSlips={cycle?.slips ?? []}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet subjectCell({ row }: { row: Duty })}
	{row.subject_kind === 'EMPLOYMENT'
		? personName(row.subject_id)
		: row.subject_kind === 'COMPANY'
			? (scope.company?.name ?? '—')
			: '—'}
{/snippet}
{#snippet statusCell({ row }: { row: Duty })}
	{@const status = obligationStatus(row, today)}
	<Badge variant={BADGE[status]}>
		{t(STATUS[status])}{status === 'LATE'
			? ` · ${t('app.payroll.days_late', { days: daysLate(row, today) })}`
			: ''}
	</Badge>
{/snippet}

{#snippet dutyTypeCell({ row }: { row: Duty })}
	{row.duty_code === FACT_OWED
		? t('app.payroll.obligation_reminder')
		: t('app.payroll.obligation_duty')}
{/snippet}

{#snippet obligationsTab()}
	{#if scope.id != null}
		<Stack gap="sm">
			<p class="text-sm text-muted-foreground">{t('app.payroll.obligations_description')}</p>
			{#key `${scope.id}:${remindersOnly}`}
				<Table
					of="obligation_instances"
					key={remindersOnly ? `reminders-${scope.id}` : `obligations-${scope.id}`}
					toolbar={{ title: t('app.payroll.tab_obligations'), new: false }}
					where={{ company_id: { eq: scope.id } }}
					initialFilter={remindersOnly
						? { duty_code: { eq: FACT_OWED }, state: { eq: 'OPEN' } }
						: { state: { eq: 'OPEN' } }}
					orderBy={{ due_on: 'asc' }}
					onOpen={(row) => openRecord('obligation_instances', row.id)}
					columns={[
						'duty_code',
						{ field: 'authority', label: t('app.payroll.obligation_type'), cell: dutyTypeCell },
						{ field: 'subject_id', label: t('app.payroll.subject'), cell: subjectCell },
						{ field: 'trigger_ref', label: t('app.payroll.obligation_trigger') },
						{ field: 'triggered_on', label: t('app.payroll.obligation_raised') },
						'due_on',
						{ field: 'state', label: t('app.payroll.status'), cell: statusCell },
						'amount_due',
						'fulfilled_on',
						'reference'
					]}
				/>
			{/key}
		</Stack>
	{/if}
{/snippet}

<Toaster />
<AppShell
	icon="lucide:badge-dollar-sign"
	title={t('app.payroll.title')}
	description={t('app.payroll.description')}
	variant="full"
>
	{#snippet actions()}
		<Cluster gap="sm">
			<CompanyScope {scope} />
			<Combobox
				size="sm"
				class="w-40"
				aria-label={t('app.payroll.period')}
				options={cycleScope.periods.map((value) => ({ value, label: value }))}
				value={creationPeriod}
				disabled={scope.id == null ||
					runs.current === undefined ||
					slips.current === undefined ||
					employments.current === undefined ||
					firstWork.current === undefined ||
					firstRoster.current === undefined}
				onChange={(next) => {
					if (next != null) selectedCycle = { company: scope.id, period: next };
				}}
			/>
		</Cluster>
	{/snippet}
	<ScopeGate {scope} empty={t('app.payroll.empty_runs')}>
		{#snippet children()}
			{#if pdfBusy}<p role="status">
					{t('app.payroll.export_payslip_pdfs')} · {pdfFiles.length}
				</p>{/if}
			{#if pdfError}<p role="alert">{pdfError}</p>{/if}
			{#if pdfFiles.length > 0}<Scroll name={t('app.payroll.export_payslip_pdfs')} max="compact">
					<Stack
						>{#each pdfFiles as file (file.id)}<a
								href={bolt.fileUrl(file as Parameters<typeof bolt.fileUrl>[0])}
								download={file.name}>{file.name}</a
							>{/each}</Stack
					>
				</Scroll>{/if}
			<Tabs
				bind:value={tab}
				onValueChange={(next) => {
					if (next === 'runs') remindersOnly = false;
				}}
				tabs={[
					{
						name: 'runs',
						title: t('app.payroll.tab_runs'),
						icon: 'lucide:badge-dollar-sign',
						body: runsTab
					},
					{
						name: 'obligations',
						title: t('app.payroll.tab_obligations'),
						icon: 'lucide:list-checks',
						body: obligationsTab
					}
				]}
			/>
		{/snippet}
	</ScopeGate>
</AppShell>
