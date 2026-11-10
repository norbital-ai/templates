<script lang="ts">
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { entityTimeZone } from '../../../lib/ui/scopes/create_scope.js';
	import { paidOn } from '../../../lib/ui/format/calendar.js';
	import { periodLabel } from '../../../lib/ui/payroll/pay_periods.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';
	import { exportSalaryListing } from '../../../lib/export_format_configuration/salary_listing_download.js';

	const scope = companyScope();
	let creating = $state(false);
	const version = $derived(
		scope.company == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { code: { eq: scope.company.settings_code } },
						fields: ['timezone'],
						limit: 1
					}
				})
	);
	const zone = $derived(entityTimeZone(null, version?.current?.jurisdiction_settings.rows[0]));
</script>

{#snippet periodCell({ value }: { value: unknown })}
	{periodLabel(String(value ?? ''), {
		first: bolt.t('app.payroll.first_half'),
		second: bolt.t('app.payroll.second_half')
	})}
{/snippet}

{#snippet payDateCell({ row, value }: { row: { state: string }; value: unknown })}
	{row.state === 'PAID' ? paidOn(value, zone) : ''}
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
				delete: true,
				actions: [
					{
						icon: 'lucide:file-spreadsheet',
						name: bolt.t('app.payroll.export_listing'),
						description: bolt.t('app.payroll.export_listing_description'),
						requiresSelection: true,
						run: exportSalaryListing
					}
				]
			}}
			columns={[
				{ field: 'period', label: bolt.t('app.payroll.period'), cell: periodCell },
				{ field: 'pay_group_id', label: bolt.t('app.payroll.pay_group') },
				'kind',
				{
					field: 'updated_at',
					label: bolt.t('models.payroll_run.fields.pay_date'),
					cell: payDateCell
				},
				'state'
			]}
		/>
		<RunCreate companyId={scope.id} bind:open={creating} />
	{/if}
</AppShell>
