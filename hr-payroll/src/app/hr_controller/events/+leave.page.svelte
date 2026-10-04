<script lang="ts">
	/**
	 * One legal entity's manual leave activities for a pay period (anything valued inside it, and time off whose days
	 * overlap it) and their payroll settlement. An approved entry is immutable; a change is a reversal.
	 */
	import ScopeGate from '../../../lib/ui/scopes/ScopeGate.svelte';
	import { t } from '../../../lib/ui/i18n/t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { leavePeriodWhere } from '../../../lib/leave/activity-fields.js';
	import CompanyScope from '../../../lib/ui/scopes/CompanyScope.svelte';
	import { companyScope, employmentNames } from '../../../lib/ui/scopes/company-scope.svelte.js';
	import { formatLeaveSummary } from '../../../lib/ui/format/display-formatters.js';
	import MonthPeriodPicker from '../../../lib/ui/components/month-period-picker.svelte';
	import BenefitCaseAdvanceStatus from '../../../lib/ui/leave/benefit-case-advance-status.svelte';
	import { bolt } from '$bolt';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { createPayPeriodScope } from '../../../lib/ui/scopes/pay-period-scope.svelte.js';
	import { toast, Toaster } from 'svelte-sonner';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import { saveBlob } from '../../../lib/ui/format/export-download.js';
	import { getErrorMessage } from '../../../lib/payroll_engine/foundation/primitives.js';
	import { XLSX_MEDIA_TYPE } from '../../../data/collection/work_days/lib/import-template.js';
	import {
		leaveBalanceWorkbook,
		type LeaveBalanceReportRow,
		type LeaveBalanceReportPage
	} from '../../../lib/leave/balance-report.js';

	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const person = employmentNames(() => scope.id);
	/** The case tabs render where the entity's lineage declares a statutory benefit case. */
	const lineage = liveRows<{
		readonly payroll: { readonly benefit_cases?: readonly unknown[] | null } | null;
	}>(() =>
		scope.company == null
			? null
			: bolt.read('jurisdiction_settings', {
					where: { code: { eq: scope.company.settings_code }, approval_id: { isNull: true } },
					select: { payroll: true },
					all: true
				})
	);
	const declaresCases = $derived(
		(lineage.current ?? []).some((row) => (row.payroll?.benefit_cases ?? []).length > 0)
	);
	let exporting = $state(false);
	/** Every balance as of today, or the selected period's end where that is earlier. */
	async function exportBalances(): Promise<void> {
		const company = scope.company;
		if (company == null) return;
		const today = todayKey();
		const end = pay.window?.end;
		const asOf = end != null && end < today ? end : today;
		exporting = true;
		try {
			const rows: LeaveBalanceReportRow[] = [];
			let after: Id<'employments'> | null = null;
			do {
				const page = (await bolt.query('leave_entries.leave_balance_report', {
					company_id: company.id,
					as_of: asOf,
					...(after == null ? {} : { after })
				})) as LeaveBalanceReportPage;
				rows.push(...page.rows);
				after = page.next_cursor;
			} while (after != null);
			rows.sort((a, b) => a.employee_number.localeCompare(b.employee_number));
			const workbook = leaveBalanceWorkbook({ company: company.name, asOf, rows });
			saveBlob(
				new Blob([await workbook.xlsx.writeBuffer()], { type: XLSX_MEDIA_TYPE }),
				`leave-balances-${asOf}.xlsx`
			);
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
		exporting = false;
	}
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet summaryCell({ value }: { value: unknown })}{formatLeaveSummary(value, t)}{/snippet}
{#snippet advanceCell({
	row
}: {
	row: { readonly id: Id<'benefit_case_plans'> };
})}<BenefitCaseAdvanceStatus planId={row.id} />{/snippet}

<Toaster />
<AppShell
	icon="lucide:calendar-check-2"
	title={t('app.leave.title')}
	description={t('app.leave.description')}
>
	{#snippet actions()}
		<MonthPeriodPicker
			month={pay.period}
			halves={pay.halves}
			weeks={pay.weeks}
			ariaLabel={t('app.events.pay_period')}
			onMonthChange={(next) => pay.select(next)}
		/>
		<CompanyScope {scope} />
	{/snippet}
	<ScopeGate {scope} empty={t('app.events.empty_scope')}>
		{#snippet children(id)}
			{#snippet leaveRows()}
				{#if pay.window != null}
					{#key `${id}:${pay.period}`}
						<Table
							of="leave_entries"
							key={`leave-${id}-${pay.period}`}
							toolbar={{
								title: t('app.leave.requests_title'),
								description: t('leave.immutable'),
								actions: [
									{
										run: exportBalances,
										group: 'import',
										icon: 'lucide:file-down',
										label: t('app.leave.export_balances'),
										disabled: () => (exporting ? t('component.loading') : null)
									}
								]
							}}
							where={{
								employment_id: { is: { company_id: { eq: id } } },
								...leavePeriodWhere(pay.window)
							}}
							orderBy={{ effective_on: 'desc' }}
							columns={[
								{ field: 'employment_id', label: t('component.person'), cell: personCell },
								{ field: 'catalogue_id', label: t('component.catalogue_leave') },
								{ field: 'summary', label: t('leave.activity'), cell: summaryCell },
								{ field: 'days', label: t('component.days') },
								{ field: 'reference', label: t('component.reference') },
								{ field: 'certificate_file', label: t('component.certificate') }
							]}
						/>
					{/key}
				{/if}
			{/snippet}
			{#snippet cases()}
				<Table
					of="benefit_cases"
					key={`benefit-cases-${id}`}
					toolbar={{ title: t('app.leave.benefit_cases'), new: true }}
					where={{ employment_id: { is: { company_id: { eq: id } } } }}
					orderBy={{ application_on: 'desc' }}
					columns={[
						'case_reference',
						'case_type',
						{ field: 'employment_id', label: t('component.person'), cell: personCell },
						'application_on',
						'expected_event_on',
						'event_on',
						'award_amount'
					]}
				/>
			{/snippet}
			{#snippet contributionHistory()}
				<Table
					of="contribution_statement_months"
					key={`contribution-history-${id}`}
					toolbar={{ title: t('app.leave.contribution_history'), new: true }}
					where={{ employee_id: { is: { employments: { some: { company_id: { eq: id } } } } } }}
					orderBy={{ coverage_month: 'desc' }}
					columns={[
						'employee_id',
						'scheme_code',
						'coverage_month',
						'credited_amount',
						'paid_on',
						'source_reference',
						'evidence_file'
					]}
				/>
			{/snippet}
			{#snippet advancePlans()}
				<Table
					of="benefit_case_plans"
					key={`benefit-plans-${id}`}
					toolbar={{
						title: t('app.leave.advance_plans'),
						description: t('app.leave.advance_plans_description'),
						new: true
					}}
					where={{
						benefit_case_id: { is: { employment_id: { is: { company_id: { eq: id } } } } }
					}}
					orderBy={{ advance_due_on: 'desc' }}
					columns={[
						'benefit_case_id',
						'revision',
						'basis_reference',
						'candidate_amount',
						'advance_due_on',
						{ field: 'id', label: t('app.leave.advance_status'), cell: advanceCell }
					]}
				/>
			{/snippet}
			{#snippet cutoffs()}
				<Table
					of="benefit_case_cutoffs"
					key={`benefit-cutoffs-${id}`}
					toolbar={{ title: t('app.leave.cutoffs'), new: true }}
					where={{
						benefit_case_plan_id: {
							is: {
								benefit_case_id: { is: { employment_id: { is: { company_id: { eq: id } } } } }
							}
						}
					}}
					orderBy={{ pay_on: 'asc' }}
					columns={[
						'benefit_case_plan_id',
						'cutoff_reference',
						'payroll_period',
						'leave_slice',
						'pay_on',
						'premium_basis',
						'premium_reference'
					]}
				/>
			{/snippet}
			{#snippet cash()}
				<Table
					of="benefit_case_movements"
					key={`benefit-cash-${id}`}
					toolbar={{
						title: t('app.leave.cash'),
						description: t('app.leave.cash_description'),
						new: true
					}}
					where={{
						benefit_case_id: { is: { employment_id: { is: { company_id: { eq: id } } } } }
					}}
					orderBy={{ paid_on: 'desc' }}
					columns={[
						'benefit_case_id',
						'kind',
						'direction',
						'paid_on',
						'amount',
						'payment_reference',
						'evidence_file'
					]}
				/>
			{/snippet}
			{#if declaresCases}
				<Tabs
					tabs={[
						{
							name: 'leave',
							title: t('app.leave.requests_title'),
							icon: 'lucide:calendar-check-2',
							body: leaveRows
						},
						{
							name: 'benefit-cases',
							title: t('app.leave.benefit_cases'),
							icon: 'lucide:file-heart',
							body: cases
						},
						{
							name: 'contribution-history',
							title: t('app.leave.contribution_history'),
							icon: 'lucide:badge-check',
							body: contributionHistory
						},
						{
							name: 'advance-plans',
							title: t('app.leave.advance_plans'),
							icon: 'lucide:file-calculator',
							body: advancePlans
						},
						{
							name: 'cutoffs',
							title: t('app.leave.cutoffs'),
							icon: 'lucide:calendar-range',
							body: cutoffs
						},
						{ name: 'cash', title: t('app.leave.cash'), icon: 'lucide:receipt', body: cash }
					]}
				/>
			{:else}
				{@render leaveRows()}
			{/if}
		{/snippet}
	</ScopeGate>
</AppShell>
