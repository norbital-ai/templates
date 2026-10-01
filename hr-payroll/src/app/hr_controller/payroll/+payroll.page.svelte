<script lang="ts">
	/**
	 * Payroll for one legal entity. Runs: the pay cycles newest first (`payCycles`), each its REGULAR run with the
	 * cycle's other runs beneath and their totals, or, before its first run, the way to start one; a run opens on its
	 * payslips, and the exports are the cycle's toolbar actions. Obligations: the entity's duty ledger, filings and
	 * remittances and the FACT_OWED reminders alike, each completed on its own record.
	 */
	import { t, type MessageKey } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Toaster } from 'svelte-sonner';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Badge, Button, EmptyState, Section, Table, Tabs, openRecord } from '@norbital-ai/ui';
	import { companyPeriods, payDateFor, periodWindow, todayKey } from '../../../lib/ui/calendar.js';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import ScopeGate from '../../../lib/ui/ScopeGate.svelte';
	import { companyScope, employmentNames } from '../../../lib/ui/company-scope.svelte.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { decodeNumber } from '../../../lib/wire.js';
	import { payCycles } from '../../../lib/pay-cycles.js';
	import { daysLate, FACT_OWED, obligationStatus } from '../../../lib/obligations/materialise.js';
	import OffCycleRun from './off-cycle-run.svelte';

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
	const progressText = (ids: readonly string[]) => {
		const own = ids.flatMap((id) => paid.get(id) ?? []);
		const done = own.filter((slip) => slip.status === 'PAID').length;
		return t('app.payroll.paid_progress', {
			paid: done,
			total: own.length,
			percent: own.length === 0 ? 0 : Math.round((done / own.length) * 100)
		});
	};
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
	 * Every cycle with a run, and the current one ahead of its first run. A period behind the latest run is never
	 * offered: the engine refuses it.
	 */
	const cycles = $derived.by(() => {
		const company = scope.company;
		if (company == null) return runCycles;
		const current = companyPeriods(periodWindow(2, 1), company.pay_frequency).find(
			(period) => payDateFor(period, company.pay_frequency) >= today
		);
		if (current == null || current <= (runCycles[0]?.period ?? '')) return runCycles;
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
	type Cycle = (typeof cycles)[number];
	const payDate = (cycle: Cycle) =>
		cycle.runs.find(({ run }) => (run.kind ?? 'REGULAR') === 'REGULAR')?.run.pay_date ??
		payDateFor(cycle.period, scope.company?.pay_frequency);
	/** The open reminders due by the cycle's pay date, while its REGULAR run is still ahead. */
	const owedBefore = (cycle: Cycle) =>
		cycle.regular
			? 0
			: (reminders.current ?? []).filter((row) => String(row.due_on) <= payDate(cycle)).length;

	let tab = $state('runs');
	let remindersOnly = $state(false);
	const showReminders = () => {
		remindersOnly = true;
		tab = 'obligations';
	};
	let adhocPeriod = $state<string | null>(null);
	const runPayroll = () => openRecord('payroll_runs', 'new');

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
	<span class={row.kind === 'REGULAR' ? 'font-medium' : 'pl-4 text-muted-foreground'}>
		{KIND[String(row.kind)] == null ? String(row.kind) : t(KIND[String(row.kind)]!)}
	</span>
{/snippet}
{#snippet paidCell({ row }: { row: { readonly id: string } })}{progressText([row.id])}{/snippet}
{#snippet total(label: string, value: string | number)}
	<Stack gap="none">
		<dt class="text-meta">{label}</dt>
		<dd class="text-sm font-medium tabular-nums">{value}</dd>
	</Stack>
{/snippet}
{#snippet owed(cycle: Cycle, place: string)}
	{@const count = owedBefore(cycle)}
	{#if count > 0}
		<Button size="sm" variant="link" class="h-auto p-0 {place}" onclick={showReminders}>
			{count === 1
				? t('app.payroll.reminders_before_run_one')
				: t('app.payroll.reminders_before_run_many', { count })}
		</Button>
	{/if}
{/snippet}

{#snippet cycleBody(companyId: Id<'companies'>, cycle: Cycle)}
	{#if cycle.runs.length === 0}
		<EmptyState
			variant="inset"
			title={t('app.payroll.no_runs_in_cycle')}
			hint={t('app.payroll.pays_line', { date: formatCalendarDate(payDate(cycle)) })}
		>
			<Button onclick={runPayroll}>{t('app.payroll.run_payroll')}</Button>
			<Button variant="outline" onclick={() => (adhocPeriod = cycle.period)}>
				{t('app.payroll.new_adhoc_run')}
			</Button>
			{@render owed(cycle, 'basis-full')}
		</EmptyState>
	{:else}
		<Stack gap="sm">
			<Cluster as="dl" gap="lg">
				{@render total(t('component.gross'), formatNumeric(cycle.totals.gross))}
				{@render total(t('component.net'), formatNumeric(cycle.totals.net))}
				{@render total(t('app.payroll.employer_cost'), formatNumeric(cycle.totals.employerCost))}
				{@render total(t('app.payroll.headcount'), cycle.totals.headcount)}
			</Cluster>
			{@render owed(cycle, 'self-start')}
			<Table
				of={cycle.runs.map(({ run, totals }) => ({
					id: run.id,
					kind: run.kind ?? 'REGULAR',
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
					new: false,
					actions: [
						...EXPORTS.map(([kind, label]) => ({
							start: 'payroll_export' as const,
							input: (ids: Id<'payroll_runs'>[]) => ({ ids, kind }),
							label: t(label),
							requiresSelection: true as const
						})),
						{
							start: 'payroll_export' as const,
							input: () => ({
								ids: cycle.runs.map(({ run }) => run.id),
								kind: 'payroll-report-xlsx' as const
							}),
							label: t('app.payroll.export_cycle_workbook')
						},
						...(cycle.regular ? [] : [{ run: runPayroll, label: t('app.payroll.run_payroll') }]),
						{ run: () => (adhocPeriod = cycle.period), label: t('app.payroll.new_adhoc_run') }
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
					{ field: 'kind', label: t('app.payroll.kind'), cell: kindCell },
					{ field: 'pay_date', label: t('app.payroll.pay_date'), cell: dayCell },
					{ field: 'id', label: t('app.payroll.status'), cell: paidCell },
					{ field: 'slips', label: t('component.payslips') },
					{ field: 'gross', label: t('component.gross'), cell: amountCell },
					{ field: 'net', label: t('component.net'), cell: amountCell },
					{ field: 'employer_cost', label: t('app.payroll.employer_cost'), cell: amountCell }
				]}
			/>
		</Stack>
	{/if}
{/snippet}

{#snippet runsTab()}
	{#if scope.id != null}
		{@const companyId = scope.id}
		<Stack gap="md">
			{#each cycles as cycle, index (cycle.period)}
				<Section
					name={`cycle-${cycle.period}`}
					title={cycle.period}
					first={index === 0}
					defaultOpen={index === 0}
					summary={cycle.runs.length === 0
						? t('app.payroll.not_started')
						: `${t('component.net')} ${formatNumeric(cycle.totals.net)} · ${progressText(cycle.runs.map(({ run }) => run.id))}`}
				>
					{@render cycleBody(companyId, cycle)}
				</Section>
			{/each}
		</Stack>
		{@const open = cycles.find((cycle) => cycle.period === adhocPeriod)}
		{#if open != null}
			<OffCycleRun
				bind:open={
					() => true,
					(next) => {
						if (!next) adhocPeriod = null;
					}
				}
				{companyId}
				settingsCode={scope.company?.settings_code ?? ''}
				period={open.period}
				cycleRuns={open.runs.map(({ run }) => run)}
				cycleSlips={open.slips}
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

{#snippet obligationsTab()}
	{#if scope.id != null}
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
					{ field: 'subject_id', label: t('app.payroll.subject'), cell: subjectCell },
					'trigger_ref',
					'due_on',
					{ field: 'state', label: t('app.payroll.status'), cell: statusCell },
					'amount_due',
					'fulfilled_on',
					'reference'
				]}
			/>
		{/key}
	{/if}
{/snippet}

<Toaster />
<AppShell
	icon="lucide:badge-dollar-sign"
	title={t('app.payroll.title')}
	description={t('app.payroll.description')}
	variant="full"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	<ScopeGate {scope} empty={t('app.payroll.empty_runs')}>
		{#snippet children()}
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
