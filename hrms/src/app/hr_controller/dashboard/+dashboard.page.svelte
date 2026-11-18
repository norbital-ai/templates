<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table, Tabs, format, open_record, singular } from '@norbital-ai/ui';
	import { observe_once } from '@norbital-ai/ui/effect';
	import { periodLabel } from '../../../lib/ui/format/period_label.js';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const company = $derived(scope.company);
	// what waits on the controller for this company: each tab is one list, and its title counts it
	const COUNTED = 100;
	const waiting = $derived(
		company === null
			? null
			: ctx.query({
					payroll_run: {
						where: { entity_id: { eq: company.id }, state: { eq: 'UNPAID' } },
						fields: ['id'],
						limit: COUNTED
					},
					obligation: {
						where: { entity_id: { eq: company.id }, state: { eq: 'OPEN' } },
						fields: ['id'],
						limit: COUNTED
					},
					statutory_finding: {
						where: { jurisdiction_code: { eq: company.settings_code }, status: { eq: 'PROPOSED' } },
						fields: ['id'],
						limit: COUNTED
					}
				})
	);
	// what waits on this person's decision, whatever the company: a held leave, claim or change they may approve
	const requests = observe_once(() => ctx.approvals.list());
	const approving = $derived(
		(requests.current ?? [])
			.filter((request) => request.moves.some((move) => move.decision === 'approve'))
			.map((request) => ({
				id: request.id,
				model: request.model,
				record: request.record,
				what: request.label ?? '',
				kind: singular(ctx, request.model),
				by: request.requestor.name ?? '',
				at: format({ kind: 'instant' }, request.at, { locale: ctx.locale })
			}))
	);
	const counted = (title: string, rows: readonly unknown[] | undefined) =>
		rows === undefined
			? title
			: `${title} (${rows.length === COUNTED ? `${COUNTED - 1}+` : rows.length})`;
</script>

{#snippet periodCell({ value }: { value: unknown })}{periodLabel(
		ctx,
		String(value ?? '')
	)}{/snippet}
{#snippet approvals()}<Table
		{ctx}
		of={approving}
		key="dashboard-approvals"
		toolbar={{ new: false, delete: false, title: ctx.t('app.dashboard.approvals') }}
		columns={[
			{ field: 'what', label: ctx.t('app.dashboard.approval_record') },
			{ field: 'kind', label: ctx.t('app.dashboard.approval_kind') },
			{ field: 'by', label: ctx.t('app.dashboard.approval_by') },
			{ field: 'at', label: ctx.t('app.dashboard.approval_at') }
		]}
		on_open={(row) => open_record(row.model, row.record)}
	/>{/snippet}
{#snippet runs()}{#if company}<Table
			{ctx}
			of="payroll_run"
			key="dashboard-runs"
			where={{ entity_id: { eq: company.id }, state: { eq: 'UNPAID' } }}
			order_by={{ pay_date: 'asc' }}
			toolbar={{ new: false, delete: false, title: ctx.t('app.dashboard.runs') }}
			columns={[
				{ field: 'period', label: ctx.t('app.payroll.period'), cell: periodCell },
				'pay_group_id',
				'kind',
				'pay_date'
			]}
		/>{/if}{/snippet}
{#snippet duties()}{#if company}<Table
			{ctx}
			of="obligation"
			key="dashboard-duties"
			where={{ entity_id: { eq: company.id }, state: { eq: 'OPEN' } }}
			order_by={{ due_on: 'asc' }}
			toolbar={{ new: false, delete: false, title: ctx.t('app.dashboard.duties') }}
			columns={['title', 'employee_id', 'due_on']}
		/>{/if}{/snippet}
{#snippet law()}{#if company}<Table
			{ctx}
			of="statutory_finding"
			key="dashboard-law"
			where={{ jurisdiction_code: { eq: company.settings_code }, status: { eq: 'PROPOSED' } }}
			order_by={{ announced_on: 'asc' }}
			toolbar={{ new: false, delete: false, title: ctx.t('app.dashboard.law') }}
			columns={['title', 'fit', 'families', 'announced_on']}
		/>{/if}{/snippet}
<AppShell
	title={ctx.t('app.dashboard.title')}
	description={ctx.t('app.dashboard.description')}
	icon="lucide:layout-dashboard"
	variant="full"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if company === null}<EmptyState title={ctx.t('app.events.empty_scope')} />{:else}<Tabs
			tabs={[
				{
					name: 'approvals',
					title: counted(ctx.t('app.dashboard.approvals'), requests.current && approving),
					icon: 'lucide:stamp',
					body: approvals
				},
				{
					name: 'runs',
					title: counted(ctx.t('app.dashboard.runs'), waiting?.current?.payroll_run.rows),
					icon: 'lucide:receipt',
					body: runs
				},
				{
					name: 'duties',
					title: counted(ctx.t('app.dashboard.duties'), waiting?.current?.obligation.rows),
					icon: 'lucide:clipboard-check',
					body: duties
				},
				{
					name: 'law',
					title: counted(ctx.t('app.dashboard.law'), waiting?.current?.statutory_finding.rows),
					icon: 'lucide:scale',
					body: law
				}
			]}
		/>{/if}
</AppShell>
