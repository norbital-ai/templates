<script lang="ts">
	/**
	 * Payroll for one legal entity: the pay cycles three months back to three ahead in the entity's own grammar (one a
	 * month, two halves, or its weeks), each with its run's paid progress and the attendance window the engine stored,
	 * and the runs themselves with the four exports (bank files, payslip PDFs, the payroll workbook and the catalogue
	 * entries), started as the `payroll_export` automation over the selected runs, and delete of an unpaid run.
	 */
	import { t, type MessageKey } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { AppShell, Cover, Inline, Stack } from '@norbital-ai/ui/layout';
	import type { Id } from '@norbital-ai/bolt';
	import { Badge, Table, Tabs } from '@norbital-ai/ui';
	import { inclusiveDays } from '../../../lib/payroll/run/dates.js';
	import { companyPeriods, payDateFor, periodWindow, todayKey } from '../../../lib/ui/calendar.js';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import { companyScope } from '../../../lib/ui/company-scope.svelte.js';
	import { formatCalendarDate } from '../../../lib/ui/display-formatters.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';

	const scope = companyScope();
	const today = todayKey();
	const runs = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payroll_runs', {
					where: { company_id: { eq: scope.id } },
					select: { period: true, attendance_from: true, attendance_to: true },
					all: true
				})
	);
	// payment is a fact of the slips: a run reads its progress rather than declaring a state
	const slips = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payslips', {
					where: { payroll_run_id: { is: { company_id: { eq: scope.id } } } },
					select: { payroll_run_id: true, status: true },
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
	const progressText = (id: unknown) => {
		const p = progress.get(String(id)) ?? { paid: 0, total: 0 };
		return t('app.payroll.paid_progress', {
			paid: p.paid,
			total: p.total,
			percent: p.total === 0 ? 0 : Math.round((p.paid / p.total) * 100)
		});
	};
	/** Three months back to three ahead; the attendance window shown is the one the engine stored on the run. */
	const cycles = $derived.by(() => {
		const company = scope.company;
		if (company == null) return [];
		const byPeriod = new Map((runs.current ?? []).map((run) => [run.period, run]));
		const open = companyPeriods(periodWindow(7, 3), company.pay_frequency)
			.map((period) => {
				const run = byPeriod.get(period);
				return {
					id: period,
					period,
					pay_date: payDateFor(period, company.pay_frequency),
					attendance:
						run == null
							? '—'
							: `${formatCalendarDate(run.attendance_from)} → ${formatCalendarDate(run.attendance_to)}`,
					run: run == null ? t('app.payroll.not_started') : progressText(run.id)
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
	const EXPORTS = [
		['bank-files', 'app.payroll.export_bank_files'],
		['payslip-pdfs', 'app.payroll.export_payslip_pdfs'],
		['payroll-report-xlsx', 'app.payroll.export_workbook'],
		['catalogue-entries-xlsx', 'app.payroll.export_catalogue_entries']
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
	<p class="text-sm text-muted-foreground">
		{scope.unknown ? t('app.hr_controller.loading_scope') : message}
	</p>
{/snippet}

{#snippet overview()}
	{#if scope.id == null}
		{@render empty(t('app.payroll.empty_overview'))}
	{:else}
		<Cover as="section" gap="md" top={cyclesHeader} aria-label={t('app.payroll.payroll_cycles')}>
			<Table
				of={cycles}
				key="cycles"
				toolbar={{ search: false, filter: false }}
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
{#snippet cyclesHeader()}
	<Inline align="end" justify="between" gap="md">
		<Stack gap="xs">
			<h2 class="text-heading">{t('app.payroll.payroll_cycles')}</h2>
			<p class="text-sm text-muted-foreground">{t('app.payroll.payroll_cycles_description')}</p>
		</Stack>
		<p class="shrink-0 text-sm text-muted-foreground">
			{#if late > 0}<span class="font-medium text-destructive"
					>{t('app.payroll.late_count', { count: late })}</span
				> ·{/if}
			{unpaid === 1
				? t('app.payroll.unpaid_run_one')
				: t('app.payroll.unpaid_runs_many', { count: unpaid })}
		</p>
	</Inline>
{/snippet}

{#snippet runsTab()}
	{#if scope.id == null}
		{@render empty(t('app.payroll.empty_runs'))}
	{:else}
		{#key scope.id}
			<Table
				of="payroll_runs"
				key={`runs-${scope.id}`}
				toolbar={{
					title: t('app.payroll.runs_title'),
					delete: true,
					actions: EXPORTS.map(([kind, label]) => ({
						start: 'payroll_export' as const,
						input: (ids: Id<'payroll_runs'>[]) => ({ ids, kind }),
						label: t(label),
						requiresSelection: true as const
					}))
				}}
				where={{ company_id: { eq: scope.id } }}
				orderBy={{ period: 'desc' }}
				columns={[
					{ field: 'period', label: t('app.payroll.period') },
					{ field: 'pay_date', label: t('app.payroll.pay_date') },
					{ field: 'id', label: t('app.payroll.paid'), cell: paidCell },
					{ field: 'settings_id', label: t('app.payroll.policy_snapshot') }
				]}
			/>
		{/key}
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
			<Cover as="section" gap="md" aria-label={t('app.payroll.vn_noncontract_obligations')}>
				<Table
					of="vn_noncontract_settlements"
					toolbar={{ title: t('app.payroll.vn_noncontract_obligations'), new: true }}
					where={{ company_id: { eq: scope.id } }}
					orderBy={{ created_at: 'desc' }}
					columns={['employee_id', 'reference', 'currency', 'agreed_gross_vnd', 'agreed_due_on']}
				/>
			</Cover>
		</Stack>
	{/if}
{/snippet}

<AppShell
	icon="lucide:badge-dollar-sign"
	title="Payroll"
	description="Create payroll runs, review payslips, export payments, and audit calculations"
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
