<script lang="ts">
	/**
	 * Payroll for one legal entity: the pay cycles three months back to three ahead in the entity's own grammar (one a
	 * month, two halves, or its weeks), each with its paid progress and the attendance window the engine stored, and the
	 * runs grouped by cycle (`payCycles`): the REGULAR run, then its off-cycle, EARLY, FINAL and CORRECTION runs, with
	 * the cycle's totals. Each run keeps the exports (bank files, payslip PDFs, the payroll workbook, the catalogue
	 * entries, returns), started as the `payroll_export` automation over the selected runs, and delete of an unpaid
	 * run; a cycle exports one workbook over all its runs and opens a new off-cycle run.
	 */
	import { t, type MessageKey } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { AppShell, Cluster, Cover, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Badge, Button, EmptyState, RunStatus, Table, Tabs, openRecord } from '@norbital-ai/ui';
	import { inclusiveDays } from '../../../lib/payroll/run/dates.js';
	import { companyPeriods, payDateFor, periodWindow, todayKey } from '../../../lib/ui/calendar.js';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import { companyScope } from '../../../lib/ui/company-scope.svelte.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';
	import { payCycles } from '../../../lib/pay-cycles.js';
	import OffCycleRun from './off-cycle-run.svelte';

	const scope = companyScope();
	const today = todayKey();
	const runs = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payroll_runs', {
					where: { company_id: { eq: scope.id } },
					select: {
						company_id: true,
						period: true,
						kind: true,
						sequence: true,
						pay_date: true,
						attendance_from: true,
						attendance_to: true
					},
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
	const progress = $derived.by(() => {
		const out = new Map<string, { paid: number; total: number }>();
		for (const slip of slips.current ?? []) {
			const p = out.get(slip.payroll_run_id) ?? { paid: 0, total: 0 };
			out.set(slip.payroll_run_id, {
				paid: p.paid + (slip.status === 'PAID' ? 1 : 0),
				total: p.total + 1
			});
		}
		return out;
	});
	const progressText = (...ids: readonly unknown[]) => {
		const p = ids.reduce<{ paid: number; total: number }>(
			(sum, id) => {
				const one = progress.get(String(id)) ?? { paid: 0, total: 0 };
				return { paid: sum.paid + one.paid, total: sum.total + one.total };
			},
			{ paid: 0, total: 0 }
		);
		return t('app.payroll.paid_progress', {
			paid: p.paid,
			total: p.total,
			percent: p.total === 0 ? 0 : Math.round((p.paid / p.total) * 100)
		});
	};
	/** The runs grouped by cycle, each payslip's money read once into the cycle's totals. */
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
	/**
	 * The runs tab's cycles: every cycle with a run, and the current one so an off-cycle run can pay ahead of its
	 * REGULAR run. A period behind the latest run is never offered: the engine refuses it.
	 */
	const runsCycles = $derived.by(() => {
		const company = scope.company;
		const current = cycles.find((row) => row.status === 'current')?.period;
		const latest = runCycles[0]?.period ?? '';
		if (company == null || current == null || current <= latest) return runCycles;
		return [
			{
				company_id: company.id,
				period: current,
				regular: false,
				runs: [],
				slips: [],
				totals: { gross: 0, net: 0, employerCost: 0, headcount: 0, slips: 0 }
			},
			...runCycles
		];
	});
	let offCyclePeriod = $state<string | null>(null);
	/** The cycle workbook in flight, per period: one `payroll_export` over every run of the cycle. */
	let cycleExports = $state<Record<string, string>>({});
	const exportCycle = (cycle: (typeof runsCycles)[number]) => {
		const handle = bolt.start('payroll_export', {
			ids: cycle.runs.map(({ run }) => run.id),
			kind: 'payroll-report-xlsx'
		});
		cycleExports = { ...cycleExports, [cycle.period]: handle.id };
	};
	const KIND: Record<string, MessageKey> = {
		REGULAR: 'models.payroll_runs.fields.kind.REGULAR',
		OFF_CYCLE: 'models.payroll_runs.fields.kind.OFF_CYCLE',
		EARLY: 'models.payroll_runs.fields.kind.EARLY',
		FINAL: 'models.payroll_runs.fields.kind.FINAL',
		CORRECTION: 'models.payroll_runs.fields.kind.CORRECTION'
	};
	/** Three months back to three ahead; the attendance window shown is the one the engine stored on the run. */
	const cycles = $derived.by(() => {
		const company = scope.company;
		if (company == null) return [];
		const byPeriod = new Map(runCycles.map((cycle) => [cycle.period, cycle]));
		const open = companyPeriods(periodWindow(7, 3), company.pay_frequency)
			.map((period) => {
				const own = byPeriod.get(period)?.runs ?? [];
				const run = (own.find(({ run }) => run.kind === 'REGULAR') ?? own[0])?.run;
				return {
					id: period,
					period,
					pay_date: payDateFor(period, company.pay_frequency),
					attendance:
						run == null
							? '—'
							: `${formatCalendarDate(run.attendance_from)} → ${formatCalendarDate(run.attendance_to)}`,
					run:
						run == null
							? t('app.payroll.not_started')
							: progressText(...own.map(({ run }) => run.id))
				};
			})
			.toSorted((a, b) => a.pay_date.localeCompare(b.pay_date));
		const current = open.findIndex((row) => row.pay_date >= today);
		return open.map((row, index) => ({
			...row,
			status: row.pay_date < today ? 'late' : index === current ? 'current' : 'next'
		}));
	});
	const late = $derived(cycles.filter((row) => row.status === 'late').length);
	const unpaid = $derived(
		(runs.current ?? []).filter((run) => {
			const p = progress.get(run.id);
			return p == null || p.paid < p.total;
		}).length
	);
	function timing(status: string, payDate: string): string {
		const days = inclusiveDays(today, payDate) - 1;
		if (status === 'late')
			return days === 0
				? t('app.payroll.due_today')
				: t('app.payroll.days_late', { days: Math.abs(days) });
		if (days <= 0) return t('app.payroll.due_today');
		return days === 1 ? t('app.payroll.due_tomorrow') : t('app.payroll.in_days', { days });
	}
	const STATUS: Record<string, MessageKey> = {
		late: 'app.payroll.status_late',
		current: 'app.payroll.status_current',
		next: 'app.payroll.status_upcoming'
	};
	// the header paragraph and the late/unpaid counts, as the toolbar's ⓘ
	const cyclesDescription = $derived(
		[
			t('app.payroll.payroll_cycles_description'),
			late > 0 ? t('app.payroll.late_count', { count: late }) : null,
			unpaid === 1
				? t('app.payroll.unpaid_run_one')
				: t('app.payroll.unpaid_runs_many', { count: unpaid })
		]
			.filter((part) => part != null)
			.join(' · ')
	);
	const EXPORTS = [
		['bank-files', 'app.payroll.export_bank_files'],
		['payslip-pdfs', 'app.payroll.export_payslip_pdfs'],
		['payroll-report-xlsx', 'app.payroll.export_workbook'],
		['catalogue-entries-xlsx', 'app.payroll.export_catalogue_entries'],
		['returns', 'app.payroll.export_returns']
	] as const;
</script>

{#snippet statusCell({ value }: { value: unknown })}
	<Badge variant={value === 'late' ? 'destructive' : value === 'current' ? 'default' : 'outline'}>
		{STATUS[String(value)] == null ? String(value) : t(STATUS[String(value)]!)}
	</Badge>
{/snippet}
{#snippet dayCell({ value }: { value: unknown })}{formatCalendarDate(value)}{/snippet}
{#snippet timingCell({ row }: { row: { readonly [f: string]: unknown } })}
	{timing(String(row.status), String(row.pay_date))}
{/snippet}
{#snippet paidCell({ row }: { row: { readonly [f: string]: unknown } })}{progressText(
		row.id
	)}{/snippet}

{#snippet empty(message: string)}
	<EmptyState title={scope.unknown ? t('app.hr_controller.loading_scope') : message} />
{/snippet}

{#snippet overview()}
	{#if scope.id == null}
		{@render empty(t('app.payroll.empty_overview'))}
	{:else}
		<Cover as="section" gap="md" aria-label={t('app.payroll.payroll_cycles')}>
			<Table
				of={cycles}
				key="cycles"
				toolbar={{
					title: t('app.payroll.payroll_cycles'),
					description: cyclesDescription,
					search: false,
					filter: false,
					new: () => openRecord('payroll_runs', 'new')
				}}
				columns={[
					{ field: 'status', label: t('app.payroll.status'), cell: statusCell },
					{ field: 'pay_date', label: t('app.payroll.pay_date'), cell: dayCell },
					{ field: 'period', label: t('app.payroll.period') },
					{ field: 'attendance', label: t('app.payroll.attendance') },
					{ field: 'run', label: t('app.payroll.run') },
					{ field: 'id', label: t('app.payroll.timing'), cell: timingCell }
				]}
			/>
		</Cover>
	{/if}
{/snippet}

{#snippet money(label: string, value: number)}
	<Stack gap="none">
		<dt class="text-meta">{label}</dt>
		<dd class="text-sm font-medium tabular-nums">{formatNumeric(value)}</dd>
	</Stack>
{/snippet}
{#snippet kindCell({ row }: { row: { readonly [f: string]: unknown } })}
	<span class={row.kind === 'REGULAR' ? 'font-medium' : 'pl-4 text-muted-foreground'}>
		{KIND[String(row.kind)] == null ? String(row.kind) : t(KIND[String(row.kind)]!)}
	</span>
{/snippet}
{#snippet amountCell({ value }: { value: unknown })}
	<span class="tabular-nums">{formatNumeric(value)}</span>
{/snippet}

{#snippet runsTab()}
	{#if scope.id == null}
		{@render empty(t('app.payroll.empty_runs'))}
	{:else if runsCycles.length === 0}
		{@render empty(t('app.payroll.no_runs'))}
	{:else}
		{@const companyId = scope.id}
		<Stack gap="xl">
			{#each runsCycles as cycle (cycle.period)}
				<Stack as="section" gap="sm" aria-label={cycle.period} data-pay-cycle={cycle.period}>
					<Cluster justify="between" align="end" gap="sm">
						<Stack gap="xs">
							<h2 class="text-heading">{cycle.period}</h2>
							<Cluster as="dl" gap="lg">
								{@render money(t('component.gross'), cycle.totals.gross)}
								{@render money(t('component.net'), cycle.totals.net)}
								{@render money(t('app.payroll.employer_cost'), cycle.totals.employerCost)}
								<Stack gap="none">
									<dt class="text-meta">{t('app.payroll.headcount')}</dt>
									<dd class="text-sm font-medium tabular-nums" data-cycle-headcount>
										{cycle.totals.headcount}
									</dd>
								</Stack>
							</Cluster>
						</Stack>
						<Cluster gap="xs">
							{#if !cycle.regular}
								<Button size="sm" variant="ghost" onclick={() => openRecord('payroll_runs', 'new')}>
									{t('app.payroll.run_payroll')}
								</Button>
							{/if}
							{#if cycle.runs.length > 0}
								<Button size="sm" variant="ghost" onclick={() => exportCycle(cycle)}>
									{t('app.payroll.export_cycle_workbook')}
								</Button>
							{/if}
							<Button size="sm" variant="outline" onclick={() => (offCyclePeriod = cycle.period)}>
								{t('app.payroll.new_off_cycle_run')}
							</Button>
						</Cluster>
					</Cluster>
					{#if cycleExports[cycle.period] != null}
						<RunStatus automation="payroll_export" run={cycleExports[cycle.period]!} />
					{/if}
					{#if cycle.runs.length > 0}
						<Table
							of={cycle.runs.map(({ run, totals }) => ({
								id: run.id,
								kind: run.kind ?? 'REGULAR',
								sequence: run.sequence ?? 1,
								pay_date: run.pay_date,
								slips: totals.slips,
								gross: totals.gross,
								net: totals.net,
								employer_cost: totals.employerCost
							}))}
							key={`runs-${companyId}-${cycle.period}`}
							toolbar={{
								title: false,
								search: false,
								filter: false,
								export: false,
								actions: EXPORTS.map(([kind, label]) => ({
									start: 'payroll_export' as const,
									input: (ids: Id<'payroll_runs'>[]) => ({ ids, kind }),
									label: t(label),
									requiresSelection: true as const
								}))
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
								{ field: 'kind', label: t('app.payroll.kind'), cell: kindCell },
								{ field: 'sequence', label: t('app.payroll.sequence') },
								{ field: 'pay_date', label: t('app.payroll.pay_date'), cell: dayCell },
								{ field: 'id', label: t('app.payroll.status'), cell: paidCell },
								{ field: 'slips', label: t('component.payslips') },
								{ field: 'gross', label: t('component.gross'), cell: amountCell },
								{ field: 'net', label: t('component.net'), cell: amountCell },
								{
									field: 'employer_cost',
									label: t('app.payroll.employer_cost'),
									cell: amountCell
								}
							]}
						/>
					{/if}
				</Stack>
			{/each}
		</Stack>
		{@const open = runsCycles.find((cycle) => cycle.period === offCyclePeriod)}
		{#if open != null}
			<OffCycleRun
				bind:open={
					() => true,
					(next) => {
						if (!next) offCyclePeriod = null;
					}
				}
				{companyId}
				period={open.period}
				cycleRuns={open.runs.map(({ run }) => run)}
				cycleSlips={open.slips}
			/>
		{/if}
	{/if}
{/snippet}

{#snippet paymentsTab()}
	{#if scope.id == null}
		{@render empty(t('app.payroll.empty_runs'))}
	{:else}
		<Stack gap="lg">
			<Cover as="section" gap="md" aria-label={t('app.payroll.payment_events')}>
				<Table
					of="payment_events"
					toolbar={{ title: t('app.payroll.payment_events'), new: true }}
					where={{ company_id: { eq: scope.id } }}
					orderBy={{ paid_on: 'desc' }}
					columns={[
						'paid_on',
						'employee_id',
						'reference',
						'currency',
						'gross_amount',
						'cash_amount'
					]}
				/>
			</Cover>
			<Cover as="section" gap="md" aria-label={t('app.payroll.noncontract_obligations')}>
				<Table
					of="noncontract_settlements"
					toolbar={{ title: t('app.payroll.noncontract_obligations'), new: true }}
					where={{ company_id: { eq: scope.id } }}
					orderBy={{ created_at: 'desc' }}
					columns={['employee_id', 'reference', 'currency', 'agreed_gross', 'agreed_due_on']}
				/>
			</Cover>
		</Stack>
	{/if}
{/snippet}

<AppShell
	icon="lucide:badge-dollar-sign"
	title={t('app.payroll.title')}
	description={t('app.payroll.description')}
	variant="full"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	<Tabs
		tabs={[
			{
				name: 'overview',
				title: t('component.tab_overview'),
				icon: 'lucide:chart-no-axes-combined',
				body: overview
			},
			{
				name: 'runs',
				title: t('app.payroll.tab_runs'),
				icon: 'lucide:badge-dollar-sign',
				body: runsTab
			},
			{
				name: 'payments',
				title: t('app.payroll.tab_payments'),
				icon: 'lucide:banknote',
				body: paymentsTab
			}
		]}
	/>
</AppShell>
