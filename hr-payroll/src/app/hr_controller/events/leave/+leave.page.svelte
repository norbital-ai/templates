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
	import PhMaternityAdvanceStatus from '../../../../lib/ui/leave/ph-maternity-advance-status.svelte';
	import { createPayPeriodScope } from '../../../../lib/ui/pay-period-scope.svelte.js';

	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const person = employmentNames(() => scope.id);
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet summaryCell({ value }: { value: unknown })}{formatLeaveSummary(value, t)}{/snippet}
{#snippet advanceCell({
	row
}: {
	row: { readonly id: Id<'ph_maternity_pay_plans'> };
})}<PhMaternityAdvanceStatus planId={row.id} />{/snippet}

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
					of="ph_maternity_cases"
					key={`ph-cases-${id}`}
					toolbar={{ title: 'Maternity cases', new: true }}
					where={{ employment_id: { is: { company_id: { eq: id } } } }}
					orderBy={{ application_on: 'desc' }}
					columns={[
						'case_reference',
						{ field: 'employment_id', label: 'Person', cell: personCell },
						'application_on',
						'expected_delivery_on',
						'event_on',
						'sss_award_amount'
					]}
				/>
			{/snippet}
			{#snippet sssHistory()}
				<Table
					of="sss_contribution_months"
					key={`ph-sss-history-${id}`}
					toolbar={{ title: 'SSS paid contribution history', new: true }}
					where={{ employee_id: { is: { employments: { some: { company_id: { eq: id } } } } } }}
					orderBy={{ coverage_month: 'desc' }}
					columns={[
						'employee_id',
						'coverage_month',
						'regular_msc',
						'paid_on',
						'source_reference',
						'evidence_file'
					]}
				/>
			{/snippet}
			{#snippet advancePlans()}
				<Stack gap="md">
					<p class="text-sm text-muted-foreground">
						A candidate is calculated from documented SSS history. The status compares recorded
						employee cash with the thirty-day advance deadline; it does not certify payment or
						settle payroll.
					</p>
					<Table
						of="ph_maternity_pay_plans"
						key={`ph-plans-${id}`}
						toolbar={{ title: 'SSS advance plans', new: true }}
						where={{
							ph_maternity_case_id: { is: { employment_id: { is: { company_id: { eq: id } } } } }
						}}
						orderBy={{ advance_due_on: 'desc' }}
						columns={[
							'ph_maternity_case_id',
							'revision',
							'basis_reference',
							'candidate_sss_amount',
							'advance_due_on',
							{ field: 'id', label: 'Recorded advance status', cell: advanceCell }
						]}
					/>
				</Stack>
			{/snippet}
			{#snippet cutoffs()}
				<Table
					of="ph_maternity_pay_cutoffs"
					key={`ph-cutoffs-${id}`}
					toolbar={{ title: 'Maternity cutoff evidence', new: true }}
					where={{
						ph_maternity_pay_plan_id: {
							is: {
								ph_maternity_case_id: { is: { employment_id: { is: { company_id: { eq: id } } } } }
							}
						}
					}}
					orderBy={{ pay_on: 'asc' }}
					columns={[
						'ph_maternity_pay_plan_id',
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
						SSS advances and salary differential are employee cash. SSS reimbursement is money
						received by the employer and is excluded from employee pay.
					</p>
					<Table
						of="ph_maternity_movements"
						key={`ph-cash-${id}`}
						toolbar={{ title: 'Maternity cash evidence', new: true }}
						where={{
							ph_maternity_case_id: { is: { employment_id: { is: { company_id: { eq: id } } } } }
						}}
						orderBy={{ paid_on: 'desc' }}
						columns={[
							'ph_maternity_case_id',
							'kind',
							'paid_on',
							'amount',
							'payment_reference',
							'evidence_file'
						]}
					/>
				</Stack>
			{/snippet}
			{#if scope.company?.settings_code === 'PH'}
				<Tabs
					tabs={[
						{
							name: 'leave',
							title: 'Leave entries',
							icon: 'lucide:calendar-check-2',
							body: leaveRows
						},
						{ name: 'maternity-cases', title: 'Maternity cases', icon: 'lucide:baby', body: cases },
						{
							name: 'sss-history',
							title: 'SSS history',
							icon: 'lucide:badge-check',
							body: sssHistory
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
