<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { entityTimeZone } from '../../../lib/ui/scopes/create_scope.js';
	import { paidOn } from '../../../lib/ui/format/calendar.js';
	import { periodLabel } from '../../../lib/ui/payroll/pay_periods.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';
	import { exportSalaryListing } from '../../../lib/export_format_configuration/salary_listing_download.js';
	let { ctx }: { ctx: PageContext } = $props();

	const scope = companyScope(ctx);
	let creating = $state(false);
	const version = $derived(
		scope.company == null
			? null
			: ctx.query({
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
		first: ctx.t('app.payroll.first_half'),
		second: ctx.t('app.payroll.second_half')
	})}
{/snippet}

{#snippet payDateCell({ row, value }: { row: { state: string }; value: unknown })}
	{row.state === 'PAID' ? paidOn(value, zone) : ''}
{/snippet}

<AppShell
	icon="lucide:receipt"
	title={ctx.t('app.payroll.runs_title')}
	description={ctx.t('app.payroll.configured_description')}
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={ctx.t('app.payroll.empty_runs')} />
	{:else}
		<Table
			{ctx}
			of="payroll_run"
			key="payroll_run"
			where={{ entity_id: { eq: scope.id } }}
			order_by={{ period: 'desc' }}
			toolbar={{
				export: false,
				title: ctx.t('app.payroll.runs_title'),
				new: () => (creating = true),
				delete: true,
				actions: [
					{
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('app.payroll.export_listing'),
						description: ctx.t('app.payroll.export_listing_description'),
						requires_selection: true,
						run: (ids) => exportSalaryListing(ctx, ids)
					}
				]
			}}
			columns={[
				{ field: 'period', label: ctx.t('app.payroll.period'), cell: periodCell },
				{ field: 'pay_group_id', label: ctx.t('app.payroll.pay_group') },
				'kind',
				{
					field: 'updated_at',
					label: ctx.t('models.payroll_run.fields.pay_date'),
					cell: payDateCell
				},
				'state'
			]}
		/>
		<RunCreate {ctx} companyId={scope.id} bind:open={creating} />
	{/if}
</AppShell>
