<script lang="ts">
	/**
	 * Every line, one tab per question: what is open, which earmarks wait for a bank, what Treasury marked for review,
	 * and the whole history. New opens the line's own form; Finance's New is an earmark.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const COLUMNS = [
		'bank_reference',
		'facility',
		'supplier',
		'product',
		'status',
		'currency',
		'amount',
		'amount_usd',
		'interest_rate_pct',
		'start_date',
		'due_date',
		'interest_to_maturity'
	] as const;
</script>

{#snippet open()}
	<Table
		{ctx}
		of="drawdown"
		where={{ status: { in: ['earmarked', 'applied', 'active'] } }}
		order_by={{ due_date: 'asc' }}
		columns={COLUMNS}
		toolbar={{ title: t('app.drawdowns.open') }}
		key="open"
	/>
{/snippet}
{#snippet earmarks()}
	<Table
		{ctx}
		of="drawdown"
		where={{ status: { eq: 'earmarked' } }}
		order_by={{ expected_draw_date: 'asc' }}
		columns={[
			'supplier',
			'facility',
			'product',
			'currency',
			'amount',
			'expected_draw_date',
			'earliest_invoice_date',
			'latest_due_date',
			'requested_by'
		]}
		toolbar={{ title: t('app.drawdowns.earmarks') }}
		actions={[
			{
				label: t('app.line.cancel'),
				confirm: t('app.drawdowns.cancel_confirm'),
				run: (row) => ctx.run('drawdown_cancel', { earmark: [row.id] })
			}
		]}
		key="earmarks"
	/>
{/snippet}
{#snippet review()}
	<Table
		{ctx}
		of="drawdown"
		where={{ needs_review: { eq: true } }}
		columns={[
			'bank_reference',
			'facility',
			'supplier',
			'status',
			'amount',
			'due_date',
			'review_note'
		]}
		toolbar={{ title: t('app.drawdowns.review'), new: false }}
		key="review"
	/>
{/snippet}
{#snippet all()}
	<Table
		{ctx}
		of="drawdown"
		order_by={{ due_date: 'desc' }}
		initial_filter={{ is_archived: { eq: false } }}
		columns={[...COLUMNS, 'settlement_date', 'settled_by', 'is_archived']}
		toolbar={{ title: t('app.drawdowns.all') }}
		key="all"
	/>
{/snippet}

<AppShell
	icon="lucide:hand-coins"
	title={t('app.drawdowns.title')}
	description={t('app.drawdowns.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'open', title: t('app.drawdowns.open'), icon: 'lucide:circle-dot', body: open },
			{
				name: 'earmarks',
				title: t('app.drawdowns.earmarks'),
				icon: 'lucide:bookmark',
				body: earmarks
			},
			{ name: 'review', title: t('app.drawdowns.review'), icon: 'lucide:flag', body: review },
			{ name: 'all', title: t('app.drawdowns.all'), icon: 'lucide:archive', body: all }
		]}
	/>
</AppShell>
