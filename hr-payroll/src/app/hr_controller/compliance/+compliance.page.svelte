<script lang="ts">
	/**
	 * The obligation ledger of one legal entity, soonest due first: every duty its settings raised, whether it is open,
	 * late, fulfilled or waived today, and its amount. Fulfilling or waiving is the record's own form; LATE is derived,
	 * never stored.
	 */
	import ScopeGate from '../../../lib/ui/ScopeGate.svelte';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/CompanyScope.svelte';
	import { companyScope } from '../../../lib/ui/company-scope.svelte.js';
	import { todayKey } from '../../../lib/ui/calendar.js';
	import { daysLate, obligationStatus } from '../../../lib/obligations/materialise.js';

	const scope = companyScope();
	const today = String(todayKey());
	type Row = {
		readonly state: string;
		readonly due_on: string;
		readonly fulfilled_on?: string | null;
	};
	const status = (row: Row): string => {
		const late = daysLate(row, today);
		const state = obligationStatus(row, today);
		return late > 0 ? `${state} (${late} days late)` : state;
	};
</script>

{#snippet statusCell({ row }: { row: Row })}{status(row)}{/snippet}

<AppShell
	icon="lucide:list-checks"
	title="Compliance"
	description="Track the employer duties the settings declare: what is owed, when it falls due, and the evidence that closed it"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	<ScopeGate {scope} empty="No duties raised yet.">
		{#snippet children(id)}
			{#key id}
				<Table
					of="obligation_instances"
					key={`obligations-${id}`}
					toolbar={{ title: 'Duties' }}
					where={{ company_id: { eq: id } }}
					initialFilter={{ state: { eq: 'OPEN' } }}
					orderBy={{ due_on: 'asc' }}
					columns={[
						'duty_code',
						'authority',
						'subject_kind',
						'trigger_ref',
						'due_on',
						{ field: 'state', label: 'Status', cell: statusCell },
						'amount_due',
						'fulfilled_on',
						'reference'
					]}
				/>
			{/key}
		{/snippet}
	</ScopeGate>
</AppShell>
