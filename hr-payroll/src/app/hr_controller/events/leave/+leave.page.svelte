<script lang="ts">
	/**
	 * One legal entity's manual leave activities for a pay period (anything valued inside it, and time off whose days
	 * overlap it) and their payroll settlement. An approved entry is immutable; a change is a reversal.
	 */
	import ScopeGate from '../../../../lib/ui/ScopeGate.svelte';
	import { t } from '../../../../lib/ui/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import { leavePeriodWhere } from '../../../../lib/leave/activity-fields.js';
	import CompanyScope from '../../../../lib/ui/CompanyScope.svelte';
	import { companyScope, employmentNames } from '../../../../lib/ui/company-scope.svelte.js';
	import { formatLeaveSummary } from '../../../../lib/ui/display-formatters.js';
	import MonthPeriodPicker from '../../../../lib/ui/month-period-picker.svelte';
	import { createPayPeriodScope } from '../../../../lib/ui/pay-period-scope.svelte.js';

	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const person = employmentNames(() => scope.id);
</script>

{#snippet personCell({ value }: { value: unknown })}{person(value)}{/snippet}
{#snippet summaryCell({ value }: { value: unknown })}{formatLeaveSummary(value, t)}{/snippet}

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
	</ScopeGate>
</AppShell>
