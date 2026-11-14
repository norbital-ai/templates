<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { EmptyState, Table, Tabs } from '@norbital-ai/ui';
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
	const counted = (title: string, rows: readonly unknown[] | undefined) =>
		rows === undefined
			? title
			: `${title} (${rows.length === COUNTED ? `${COUNTED - 1}+` : rows.length})`;
</script>

{#snippet runs()}{#if company}<Table
			{ctx}
			of="payroll_run"
			key="close-runs"
			where={{ entity_id: { eq: company.id }, state: { eq: 'UNPAID' } }}
			order_by={{ pay_date: 'asc' }}
			toolbar={{ new: false, delete: false, title: ctx.t('app.month_close.runs') }}
			columns={['period', 'pay_group_id', 'kind', 'pay_date']}
		/>{/if}{/snippet}
{#snippet duties()}{#if company}<Table
			{ctx}
			of="obligation"
			key="close-duties"
			where={{ entity_id: { eq: company.id }, state: { eq: 'OPEN' } }}
			order_by={{ due_on: 'asc' }}
			toolbar={{ new: false, delete: false, title: ctx.t('app.month_close.duties') }}
			columns={['title', 'employee_id', 'due_on']}
		/>{/if}{/snippet}
{#snippet law()}{#if company}<Table
			{ctx}
			of="statutory_finding"
			key="close-law"
			where={{ jurisdiction_code: { eq: company.settings_code }, status: { eq: 'PROPOSED' } }}
			order_by={{ announced_on: 'asc' }}
			toolbar={{ new: false, delete: false, title: ctx.t('app.month_close.law') }}
			columns={['title', 'fit', 'families', 'announced_on']}
		/>{/if}{/snippet}
<AppShell
	title={ctx.t('app.month_close.title')}
	description={ctx.t('app.month_close.description')}
	icon="lucide:list-checks"
	variant="full"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if company === null}<EmptyState title={ctx.t('app.events.empty_scope')} />{:else}<Tabs
			tabs={[
				{
					name: 'runs',
					title: counted(ctx.t('app.month_close.runs'), waiting?.current?.payroll_run.rows),
					icon: 'lucide:receipt',
					body: runs
				},
				{
					name: 'duties',
					title: counted(ctx.t('app.month_close.duties'), waiting?.current?.obligation.rows),
					icon: 'lucide:clipboard-check',
					body: duties
				},
				{
					name: 'law',
					title: counted(ctx.t('app.month_close.law'), waiting?.current?.statutory_finding.rows),
					icon: 'lucide:scale',
					body: law
				}
			]}
		/>{/if}
</AppShell>
