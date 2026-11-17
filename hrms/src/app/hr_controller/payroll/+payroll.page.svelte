<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table, format } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';
	import { exportSalaryListing } from '../../../lib/export_format_configuration/salary_listing_download.js';
	import { periodLabel } from '../../../lib/ui/format/period_label.js';
	let { ctx }: { ctx: PageContext } = $props();

	const scope = companyScope(ctx);
	let creating = $state(false);
</script>

{#snippet periodCell({ value }: { value: unknown })}{periodLabel(
		ctx,
		String(value ?? '')
	)}{/snippet}

{#snippet payDateCell({ value }: { value: unknown })}
	{value == null ? '' : format({ kind: 'date' }, String(value), { locale: ctx.locale })}
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
					field: 'pay_date',
					label: ctx.t('models.payroll_run.fields.pay_date'),
					cell: payDateCell
				},
				'state'
			]}
		/>
		<RunCreate {ctx} companyId={scope.id} bind:open={creating} />
	{/if}
</AppShell>
