<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { periodLabel } from '../../../lib/ui/payroll/pay_periods.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';

	const scope = companyScope();
	let creating = $state(false);
</script>

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
				'state'
			]}
		/>
		<RunCreate companyId={scope.id} bind:open={creating} />
	{/if}
</AppShell>
