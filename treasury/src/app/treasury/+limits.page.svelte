<script lang="ts">
	/**
	 * The one place for limits and terms: each facility's limit, pricing, day basis, rounding, maximum tenor and review
	 * dates (every change keeps its earlier value in the record's history), the room left on each, and the sub-limits.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { FACILITY_FIELDS, LINE_FIELDS, headroom } from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const read = ctx.query({
		facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
		drawdown: {
			where: { status: { in: ['earmarked', 'applied', 'active'] } },
			fields: [...LINE_FIELDS]
		}
	});
	const room = $derived(
		headroom(read.current?.facility.rows ?? [], read.current?.drawdown.rows ?? [])
	);
</script>

{#snippet terms()}
	<Table
		{ctx}
		of="facility"
		key="terms"
		initial_filter={{ status: { eq: 'active' } }}
		columns={[
			'name',
			'bank',
			'entity',
			'currency',
			'limit',
			'status',
			'pricing_basis',
			'margin_pct',
			'day_count_basis',
			'interest_rounding',
			'max_tenor_days',
			'review_date',
			'expiry_date'
		]}
		toolbar={{ title: t('app.limits.terms') }}
	/>
{/snippet}
{#snippet usage()}
	<Table
		{ctx}
		of={room}
		controlled
		columns={[
			{ field: 'bank', label: t('app.line.bank') },
			{ field: 'name', label: t('app.line.facility') },
			{ field: 'limit', label: t('app.line.limit'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'used', label: t('app.line.used'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'earmarked', label: t('app.line.earmarked'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'available', label: t('app.line.available'), kind: { kind: 'decimal', scale: 2 } }
		]}
		toolbar={{ title: t('app.limits.headroom') }}
	/>
{/snippet}
{#snippet subLimits()}
	<Table
		{ctx}
		of="sub_limit"
		key="sub_limits"
		columns={['facility', 'name', 'product', 'supplier', 'limit']}
		toolbar={{ title: t('app.limits.sub_limits') }}
	/>
{/snippet}

<AppShell
	icon="lucide:gauge"
	title={t('app.limits.title')}
	description={t('app.limits.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'terms', title: t('app.limits.terms'), icon: 'lucide:gauge', body: terms },
			{ name: 'headroom', title: t('app.limits.headroom'), icon: 'lucide:chart-bar', body: usage },
			{
				name: 'sub_limits',
				title: t('app.limits.sub_limits'),
				icon: 'lucide:split',
				body: subLimits
			}
		]}
	/>
</AppShell>
