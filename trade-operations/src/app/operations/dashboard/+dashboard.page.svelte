<script lang="ts">
	// What needs the viewer now: drafts to sync, approvals, Kingdee follow-up, overdue receivables and credit exceptions.
	// A tile shows only what the viewer's policies read and opens the table or report it counts; money stays in its own
	// currency.
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { BigDecimal } from 'effect';
	import { EmptyState, Show, Table, open_record, singular, type Kind } from '@norbital-ai/ui';
	import { create_toggle_group } from '@norbital-ai/ui/behaviors';
	import { AppShell, Bound, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { observe_once } from '@norbital-ai/ui/effect';
	import {
		agingSummary,
		creditExceptions,
		creditRead,
		creditTotals,
		estimateAging,
		overdueTotals,
		readAgingAt
	} from '../../../lib/reports.js';
	import Tile from './tile.svelte';

	let { ctx }: { ctx: PageContext } = $props();
	const day = ctx.clock('day');
	const moneyKind: Kind = { kind: 'money', currency: 'currency' };
	const orders = $derived(ctx.catalog?.orders);
	// a narrower output (logistics) carries no commercial terms: drafts and sales are commercial work
	const commercial = $derived(Boolean(orders && orders.output === undefined));
	const ages = $derived(Boolean(ctx.catalog?.transactions && ctx.catalog?.source_payments));
	const shown = $derived({
		drafts: commercial,
		approvals: Boolean(orders),
		kingdee: Boolean(orders),
		overdue: ages,
		credit: Boolean(ctx.catalog?.credit_snapshots)
	});

	const draft = { status: { eq: 'draft' }, archived: { eq: false } } as const;
	const drafts = $derived(
		commercial ? ctx.query({ orders: { where: draft, fields: ['number'] } }) : null
	);
	// synced orders Kingdee has yet to audit (or read back), and the latest changes whose sync failed
	const synced = { status: { eq: 'confirmed' }, archived: { eq: false } } as const;
	const awaiting = $derived(
		orders
			? ctx.query({
					orders: {
						where: {
							...synced,
							or: [
								{ kingdee: { is_null: true } },
								{ kingdee: { contains: { status: 'draft', closed: false } } }
							]
						},
						fields: ['number']
					}
				})
			: null
	);
	// ponytail: `$sync` is not filterable, so only the 200 latest-changed synced orders are checked for a failed sync
	const recent = $derived(
		orders
			? ctx.query({
					orders: {
						where: synced,
						fields: ['number'],
						order_by: { updated_at: 'desc' },
						limit: 200
					}
				})
			: null
	);
	const failed = $derived(
		recent?.current?.orders.rows.flatMap((row) =>
			row.$sync?.kingdee?.status === 'failed' ? [row.id] : []
		) ?? []
	);
	const pending = $derived(
		awaiting?.current?.orders.rows.flatMap((row) => (failed.includes(row.id) ? [] : [row.id])) ?? []
	);

	// the open requests on orders and their lines the viewer may decide or asked for
	const requests = observe_once(() => ctx.approvals.list());
	const approvals = $derived(
		requests.current
			?.filter(
				(request) =>
					(request.model === 'orders' || request.model === 'order_lines') &&
					(request.mine || request.moves.some((move) => move.decision === 'approve'))
			)
			.map((request) => ({
				id: request.id,
				model: request.model,
				record: request.record,
				what: request.label ?? '',
				kind: singular(ctx, request.model),
				by: request.requestor.name ?? '',
				at: request.at,
				mine: request.mine
			}))
	);

	// receivables on today, as the aging and credit tabs read them
	const aging = observe_once(() =>
		ages ? readAgingAt(ctx, day.today, Boolean(ctx.catalog?.source_receivables)) : null
	);
	const overdue = $derived(
		aging.current
			? overdueTotals(
					agingSummary(
						aging.current.heads.length
							? estimateAging(aging.current.rows ?? [])
							: (aging.current.rows ?? [])
					)
				)
			: null
	);
	const credit = $derived(shown.credit ? ctx.query(creditRead) : null);
	const creditFigures = $derived(
		credit?.current && (!ages || aging.current || aging.error)
			? creditTotals(
					creditExceptions(
						credit.current.credit_snapshots.rows,
						aging.current?.rows ?? [],
						day.today
					).customers
				)
			: null
	);

	type Opens = 'drafts' | 'approvals' | 'kingdee';
	let chosen = $state<Opens | null>(null);
	const opened = $derived(
		(['drafts', 'approvals', 'kingdee'] as const).find((name) => name === chosen && shown[name]) ??
			(['drafts', 'approvals', 'kingdee'] as const).find((name) => shown[name]) ??
			null
	);
	const viewToggle = create_toggle_group({
		items: () => (['drafts', 'approvals', 'kingdee'] as const).filter((name) => shown[name]),
		mode: 'single',
		value: () => (opened !== null ? [opened] : []),
		on_change: (values) => {
			const next = values[0];
			if (next === 'drafts' || next === 'approvals' || next === 'kingdee') chosen = next;
		},
		control: { id: 'trade-dashboard:view', label: 'Dashboard' }
	});
	const analysis = (tab: 'aging' | 'credit') =>
		`${ctx.href('operations/analysis', 'reports')}?${new URLSearchParams(tab === 'aging' ? { tab, as_of: day.today } : { tab })}`;
	const orderColumns = $derived([
		'number',
		'title',
		'party',
		'direction',
		'status',
		...(orders?.fields?.total ? (['total'] as const) : []),
		'owner'
	] as const);
</script>

{#snippet count(value: number | undefined, failure: unknown)}
	{#if failure}<span class="text-meta">{ctx.t('dashboard.unavailable')}</span>
	{:else if value === undefined}<span class="text-meta">{ctx.t('dashboard.loading')}</span>
	{:else}<span class="text-section tabular-nums">{value}</span>{/if}
{/snippet}
{#snippet meta(parts: readonly (readonly [string, number])[])}
	{@const shownParts = parts.filter(([, value]) => value > 0)}
	{#if shownParts.length}<span class="text-meta"
			>{shownParts.map(([text, value]) => `${text} ${value}`).join(' · ')}</span
		>{/if}
{/snippet}
{#snippet money(
	rows: readonly { currency: string; amount: string | null; note: string }[] | null,
	failure: unknown
)}
	{#if failure}<span class="text-meta">{ctx.t('dashboard.unavailable')}</span>
	{:else if rows === null}<span class="text-meta">{ctx.t('dashboard.loading')}</span>
	{:else if rows.length === 0}<span class="text-meta">{ctx.t('dashboard.none')}</span>
	{:else}
		{#each rows as row (row.currency)}
			<Stack as="span" gap="none">
				<span class="text-heading tabular-nums"
					><Show {ctx} kind={moneyKind} value={row.amount} {row} /></span
				>
				<span class="text-meta">{row.note}</span>
			</Stack>
		{/each}
	{/if}
{/snippet}

{#snippet table()}
	{#if opened === 'approvals'}
		<Table
			{ctx}
			of={approvals ?? []}
			key="dashboard_approvals"
			columns={[
				{ field: 'what', label: ctx.t('dashboard.approval_record') },
				{ field: 'kind', label: ctx.t('dashboard.approval_kind') },
				{ field: 'by', label: ctx.t('dashboard.approval_by') },
				{ field: 'at', label: ctx.t('dashboard.approval_at'), kind: { kind: 'instant' } }
			]}
			on_open={(row) => open_record(row.model, row.record)}
			toolbar={{ title: ctx.t('dashboard.approvals'), new: false, delete: false }}
		/>
	{:else if opened}
		<Table
			{ctx}
			of="orders"
			key={`dashboard_${opened}`}
			where={opened === 'drafts' ? draft : { id: { in: [...failed, ...pending] } }}
			columns={orderColumns}
			toolbar={{ title: ctx.t(`dashboard.${opened}`), new: false, delete: false }}
		/>
	{/if}
{/snippet}

<AppShell
	description={ctx.t('app.dashboard.description')}
	icon="lucide:layout-dashboard"
	title={ctx.t('component.dashboard')}
	variant="full"
>
	<Scroll name="dashboard" size="fill" inset>
		{#if !Object.values(shown).some(Boolean)}<EmptyState title={ctx.t('dashboard.access')} />
		{:else}
			<Stack gap="md">
				<Grid minimum="compact" gap="sm" onkeydown={viewToggle.root_attrs().onkeydown}>
					{#if shown.drafts}
						<Tile
							{...viewToggle.item_attrs('drafts')}
							{@attach viewToggle.item('drafts')}
							title={ctx.t('dashboard.drafts')}
							icon="lucide:file-pen"
							selected={opened === 'drafts'}
						>
							{@render count(drafts?.current?.orders.total, drafts?.error)}
							<span class="text-meta">{ctx.t('dashboard.drafts_hint')}</span>
						</Tile>
					{/if}
					{#if shown.approvals}
						<Tile
							{...viewToggle.item_attrs('approvals')}
							{@attach viewToggle.item('approvals')}
							title={ctx.t('dashboard.approvals')}
							icon="lucide:stamp"
							selected={opened === 'approvals'}
						>
							{@render count(approvals?.length, requests.error)}
							{@render meta([
								[
									ctx.t('dashboard.approvals_decide'),
									approvals?.filter((row) => !row.mine).length ?? 0
								],
								[
									ctx.t('dashboard.approvals_mine'),
									approvals?.filter((row) => row.mine).length ?? 0
								]
							])}
						</Tile>
					{/if}
					{#if shown.kingdee}
						<Tile
							{...viewToggle.item_attrs('kingdee')}
							{@attach viewToggle.item('kingdee')}
							title={ctx.t('dashboard.kingdee')}
							icon="lucide:refresh-cw"
							selected={opened === 'kingdee'}
						>
							{@render count(
								awaiting?.current && recent?.current ? failed.length + pending.length : undefined,
								awaiting?.error ?? recent?.error
							)}
							{@render meta([
								[ctx.t('dashboard.kingdee_failed'), failed.length],
								[ctx.t('component.contract_pending'), pending.length]
							])}
						</Tile>
					{/if}
					{#if shown.overdue}
						<Tile
							title={ctx.t('dashboard.overdue')}
							icon="lucide:clock-alert"
							href={analysis('aging')}
						>
							{@render money(
								overdue?.map((row) => ({
									currency: row.currency,
									amount: row.overdue,
									note: ctx.t('dashboard.customers_count', { count: row.customers })
								})) ?? null,
								aging.error
							)}
						</Tile>
					{/if}
					{#if shown.credit}
						<Tile
							title={ctx.t('component.credit_exceptions')}
							icon="lucide:shield-alert"
							href={analysis('credit')}
						>
							{@render count(
								creditFigures?.reduce((sum, row) => sum + row.customers, 0),
								credit?.error
							)}
							{#each creditFigures ?? [] as row (row.currency)}
								{@const over = row.figures.find((figure) => figure.field === 'over_limit')?.value}
								{#if over && BigDecimal.isPositive(BigDecimal.fromStringUnsafe(over))}
									<span class="text-meta"
										>{ctx.t('reports.credit.over_limit')}
										<Show {ctx} kind={moneyKind} value={over} {row} /></span
									>
								{/if}
							{/each}
						</Tile>
					{/if}
				</Grid>
				{#if opened}<Bound size="viewport">{@render table()}</Bound>{/if}
			</Stack>
		{/if}
	</Scroll>
</AppShell>
