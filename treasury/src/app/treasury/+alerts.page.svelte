<script lang="ts">
	/**
	 * What needs attention today, one list per tab: lines due within 7 days, past due without a settlement advice,
	 * banks at 80% or more, facility reviews within 60 days, earmarks past their date, LC and DA bills to decide within
	 * 14 days, LCs expiring within 14 days, lines due after the latest date their bank finances to, lines marked for
	 * review, LCs to open, and T/T payments from facility forms. The morning notice counts the same lists.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { addDays } from '../../lib/calculations.js';
	import { FACILITY_FIELDS, LINE_FIELDS, utilisation } from '../../lib/treasury.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const today = $derived(day.today);
	const OPEN = ['applied', 'active'] as const;
	const LINE = [
		'bank_reference',
		'facility',
		'supplier',
		'product',
		'amount_usd',
		'due_date'
	] as const;
	const usage = ctx.query({
		facility: { fields: [...FACILITY_FIELDS], bank: { fields: ['code'] } },
		drawdown: { where: { status: { in: ['earmarked', ...OPEN] } }, fields: [...LINE_FIELDS] }
	});
	const high = $derived(
		utilisation(
			usage.current?.facility.rows ?? [],
			usage.current?.drawdown.rows ?? []
		).banks.filter((b) => b.high)
	);
</script>

{#snippet due()}
	<Table
		{ctx}
		of="drawdown"
		key="due"
		where={{ status: { in: OPEN }, due_date: { lte: addDays(today, 7) } }}
		order_by={{ due_date: 'asc' }}
		columns={LINE}
		toolbar={{ title: t('app.alerts.due'), new: false }}
	/>
{/snippet}
{#snippet past()}
	<Table
		{ctx}
		of="drawdown"
		key="past"
		where={{ status: { in: OPEN }, due_date: { lt: today } }}
		order_by={{ due_date: 'asc' }}
		columns={LINE}
		toolbar={{ title: t('app.alerts.past_due'), new: false }}
	/>
{/snippet}
{#snippet banks()}
	<Table
		{ctx}
		of={high}
		controlled
		columns={[
			{ field: 'bank', label: t('app.dashboard.bank') },
			{ field: 'used_pct', label: t('app.alerts.used_pct'), kind: { kind: 'decimal', scale: 1 } },
			{ field: 'limit', label: t('app.dashboard.limit'), kind: { kind: 'decimal', scale: 2 } },
			{ field: 'used', label: t('app.dashboard.used'), kind: { kind: 'decimal', scale: 2 } },
			{
				field: 'available',
				label: t('app.dashboard.available'),
				kind: { kind: 'decimal', scale: 2 }
			}
		]}
		toolbar={{ title: t('app.alerts.high') }}
	/>
{/snippet}
{#snippet reviews()}
	<Table
		{ctx}
		of="facility"
		key="reviews"
		where={{ status: { eq: 'active' }, review_date: { lte: addDays(today, 60) } }}
		order_by={{ review_date: 'asc' }}
		columns={['name', 'bank', 'limit', 'review_date', 'expiry_date']}
		toolbar={{ title: t('app.alerts.reviews'), new: false }}
	/>
{/snippet}
{#snippet stale()}
	<Table
		{ctx}
		of="drawdown"
		key="stale"
		where={{ status: { eq: 'earmarked' }, expected_draw_date: { lt: today } }}
		order_by={{ expected_draw_date: 'asc' }}
		columns={['supplier', 'facility', 'amount_usd', 'expected_draw_date', 'requested_by']}
		toolbar={{ title: t('app.alerts.stale'), new: false }}
	/>
{/snippet}
{#snippet bills()}
	<Table
		{ctx}
		of="drawdown"
		key="bills"
		where={{
			status: { in: OPEN },
			product: { in: ['lc', 'import_bill', 'da', 'tb'] },
			due_date: { lte: addDays(today, 14) }
		}}
		order_by={{ due_date: 'asc' }}
		columns={LINE}
		toolbar={{ title: t('app.alerts.bills'), new: false }}
	/>
{/snippet}
{#snippet expiring()}
	<Table
		{ctx}
		of="drawdown"
		key="expiring"
		where={{
			status: { in: OPEN },
			product: { eq: 'lc' },
			lc_expiry_date: { lte: addDays(today, 14) }
		}}
		order_by={{ lc_expiry_date: 'asc' }}
		columns={['lc_number', 'bank_reference', 'facility', 'supplier', 'lc_expiry_date']}
		toolbar={{ title: t('app.alerts.lc_expiry'), new: false }}
	/>
{/snippet}
{#snippet late()}
	<Table
		{ctx}
		of="drawdown"
		key="late"
		where={{
			status: { in: ['earmarked', ...OPEN] },
			due_date: { gt: { field: 'latest_due_date' } }
		}}
		columns={[
			'bank_reference',
			'facility',
			'supplier',
			'due_date',
			'earliest_invoice_date',
			'latest_due_date'
		]}
		toolbar={{ title: t('app.alerts.late'), new: false }}
	/>
{/snippet}
{#snippet review()}
	<Table
		{ctx}
		of="drawdown"
		key="flagged"
		where={{ needs_review: { eq: true } }}
		columns={['bank_reference', 'facility', 'status', 'review_note']}
		toolbar={{ title: t('app.drawdowns.review'), new: false }}
	/>
{/snippet}
{#snippet lcs()}
	<Table
		{ctx}
		of="purchase_order"
		key="lcs"
		where={{ lc_requested: { eq: true }, is_cancelled: { eq: false }, lc_links: { eq: 0 } }}
		order_by={{ po_date: 'asc' }}
		columns={['po_number', 'supplier', 'currency', 'amount', 'po_date', 'created_by']}
		toolbar={{ title: t('app.alerts.lcs'), new: false }}
	/>
{/snippet}
{#snippet tt()}
	<Table
		{ctx}
		of="facility_form"
		key="tt"
		where={{
			facility_required: { eq: 'tt' },
			pay_by_date: { gte: addDays(today, -7), lte: addDays(today, 14) }
		}}
		order_by={{ pay_by_date: 'asc' }}
		columns={['po_number', 'vendor', 'currency', 'amount', 'pay_by_date', 'remarks']}
		toolbar={{ title: t('app.alerts.tt'), new: false }}
	/>
{/snippet}

<AppShell
	icon="lucide:bell"
	title={t('app.alerts.title')}
	description={t('app.alerts.description')}
	variant="full"
>
	<Tabs
		orientation="vertical"
		tabs={[
			{ name: 'due', title: t('app.alerts.due'), icon: 'lucide:calendar-clock', body: due },
			{ name: 'past', title: t('app.alerts.past_due'), icon: 'lucide:calendar-x', body: past },
			{ name: 'banks', title: t('app.alerts.high'), icon: 'lucide:gauge', body: banks },
			{ name: 'reviews', title: t('app.alerts.reviews'), icon: 'lucide:file-clock', body: reviews },
			{ name: 'stale', title: t('app.alerts.stale'), icon: 'lucide:bookmark-x', body: stale },
			{ name: 'bills', title: t('app.alerts.bills'), icon: 'lucide:split', body: bills },
			{
				name: 'expiring',
				title: t('app.alerts.lc_expiry'),
				icon: 'lucide:hourglass',
				body: expiring
			},
			{ name: 'late', title: t('app.alerts.late'), icon: 'lucide:calendar-range', body: late },
			{ name: 'review', title: t('app.drawdowns.review'), icon: 'lucide:flag', body: review },
			{ name: 'lcs', title: t('app.alerts.lcs'), icon: 'lucide:file-plus', body: lcs },
			{ name: 'tt', title: t('app.alerts.tt'), icon: 'lucide:send', body: tt }
		]}
	/>
</AppShell>
