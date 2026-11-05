<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, RecordShell, Sheet, Table, Tabs } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { periodLabel } from '../../../lib/ui/payroll/pay_periods.js';

	const scope = companyScope();
	let creating = $state(false);
</script>

<!-- a run's warnings are one per line: the list shows how many, the run lists them -->
{#snippet periodCell({ value }: { value: unknown })}
	{periodLabel(String(value ?? ''), {
		first: bolt.t('app.payroll.first_half'),
		second: bolt.t('app.payroll.second_half')
	})}
{/snippet}

<AppShell
	icon="lucide:receipt"
	title={bolt.t('app.payroll.runs_title')}
	description={bolt.t('app.payroll.configured_description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={bolt.t('app.payroll.empty_runs')} />
	{:else}
		<Table
			of="payroll_run"
			key="payroll_run"
			where={{ entity_id: { eq: scope.id } }}
			orderBy={{ period: 'desc' }}
			toolbar={{
				export: false,
				title: bolt.t('app.payroll.runs_title'),
				new: () => (creating = true),
				delete: true
			}}
			columns={[
				{ field: 'period', label: bolt.t('app.payroll.period'), cell: periodCell },
				'kind',
				'pay_date',
				'pay_due_date',
				'attendance_coverage',
				'findings',
				'state'
			]}
		/>
		{@const companyId = scope.id}
		{#snippet regular()}<RecordShell
				of="payroll_run"
				mode="create"
				values={{ entity_id: companyId, kind: 'REGULAR' }}
				onDone={() => (creating = false)}
			/>{/snippet}
		{#snippet other()}<RecordShell
				of="payroll_run"
				mode="create"
				values={{ entity_id: companyId, kind: 'OFF_CYCLE' }}
				onDone={() => (creating = false)}
			/>{/snippet}
		<Sheet bind:open={creating} title={bolt.t('v2.create_run')}
			><Tabs
				tabs={[
					{ name: 'regular', title: bolt.t('v2.scheduled_cycles'), body: regular },
					{ name: 'other', title: bolt.t('v2.other_run'), body: other }
				]}
			/>
		</Sheet>
	{/if}
</AppShell>
