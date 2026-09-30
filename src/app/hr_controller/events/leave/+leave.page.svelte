<script lang="ts">
	/**
	 * One legal entity's manual leave activities for a pay period (anything valued inside it, and time off whose days
	 * overlap it) and their payroll settlement. An approved entry is immutable; a change is a reversal.
	 */
	import ScopeGate from '../../../../lib/ui/ScopeGate.svelte';
	import { t } from '../../../../lib/ui/t.js';
	import type { Id } from '@norbital-ai/bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { leavePeriodWhere } from '../../../../lib/leave/activity-fields.js';
	import CompanyScope from '../../../../lib/ui/CompanyScope.svelte';
	import { companyScope, employmentNames } from '../../../../lib/ui/company-scope.svelte.js';
	import { formatLeaveSummary } from '../../../../lib/ui/display-formatters.js';
	import MonthPeriodPicker from '../../../../lib/ui/month-period-picker.svelte';
	import BenefitCaseAdvanceStatus from '../../../../lib/ui/leave/benefit-case-advance-status.svelte';
	import { bolt } from '$bolt';
	import { liveRows } from '../../../../lib/ui/live.svelte.js';
	import { createPayPeriodScope } from '../../../../lib/ui/pay-period-scope.svelte.js';

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
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet summaryCell({ value }: { value: unknown })}{formatLeaveSummary(value, t)}{/snippet}
{#snippet advanceCell({
	row
}: {
	row: { readonly id: Id<'benefit_case_plans'> };
})}<BenefitCaseAdvanceStatus planId={row.id} />{/snippet}

<AppShell
	icon="lucide:calendar-check-2"
	title="Leave"
	description="Manual leave activities and their payroll settlement"
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
							toolbar={{ title: t('app.leave.requests_title'), description: t('leave.immutable') }}
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
					toolbar={{ title: 'Benefit cases', new: true }}
					where={{ employment_id: { is: { company_id: { eq: id } } } }}
					orderBy={{ application_on: 'desc' }}
					columns={[
						'case_reference',
						'case_type',
						{ field: 'employment_id', label: 'Person', cell: personCell },
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
					toolbar={{ title: 'Paid contribution history', new: true }}
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
				<Stack gap="md">
					<p class="text-sm text-muted-foreground">
						A candidate is calculated from documented contribution history. The status compares
						recorded employee cash with the case type's advance deadline; it does not certify
						payment or settle payroll.
					</p>
					<Table
						of="benefit_case_plans"
						key={`benefit-plans-${id}`}
						toolbar={{ title: 'Advance plans', new: true }}
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
							{ field: 'id', label: 'Recorded advance status', cell: advanceCell }
						]}
					/>
				</Stack>
			{/snippet}
			{#snippet cutoffs()}
				<Table
					of="benefit_case_cutoffs"
					key={`benefit-cutoffs-${id}`}
					toolbar={{ title: 'Benefit cutoff evidence', new: true }}
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
				<Stack gap="md">
					<p class="text-sm text-muted-foreground">
						Award advances and salary differential are employee cash. The scheme's refund is money
						received by the employer and is excluded from employee pay.
					</p>
					<Table
						of="benefit_case_movements"
						key={`benefit-cash-${id}`}
						toolbar={{ title: 'Benefit cash evidence', new: true }}
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
				</Stack>
			{/snippet}
			{#if declaresCases}
				<Tabs
					tabs={[
						{
							name: 'leave',
							title: 'Leave entries',
							icon: 'lucide:calendar-check-2',
							body: leaveRows
						},
						{
							name: 'benefit-cases',
							title: 'Benefit cases',
							icon: 'lucide:file-heart',
							body: cases
						},
						{
							name: 'contribution-history',
							title: 'Contribution history',
							icon: 'lucide:badge-check',
							body: contributionHistory
						},
						{
							name: 'advance-plans',
							title: 'Advance plans',
							icon: 'lucide:file-calculator',
							body: advancePlans
						},
						{ name: 'cutoffs', title: 'Cutoffs', icon: 'lucide:calendar-range', body: cutoffs },
						{ name: 'cash', title: 'Cash evidence', icon: 'lucide:receipt', body: cash }
					]}
				/>
			{:else}
				{@render leaveRows()}
			{/if}
		{/snippet}
	</ScopeGate>
</AppShell>
