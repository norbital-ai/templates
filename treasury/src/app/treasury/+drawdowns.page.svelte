<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, format } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

{#snippet moneyCell({
	row,
	value
}: {
	row: { readonly currency: string | null };
	value: string | null | undefined;
})}
	{value == null
		? '—'
		: format({ kind: 'money' }, value, {
				locale: ctx.locale,
				...(row.currency ? { currency: row.currency } : {})
			})}
{/snippet}

<AppShell
	icon="lucide:hand-coins"
	title={t('app.drawdowns.title')}
	description={t('app.drawdowns.description')}
>
	<Table
		{ctx}
		of="drawdown"
		initial_filter={{
			status: { in: ['earmarked', 'applied', 'active'] },
			is_archived: { eq: false }
		}}
		order_by={{ due_date: 'asc' }}
		columns={[
			'bank_reference',
			'facility',
			'supplier',
			'product',
			'status',
			{
				field: 'amount',
				kind: { kind: 'money', currency: 'currency' },
				align: 'end',
				cell: moneyCell
			},
			'due_date'
		]}
		toolbar={{ title: false }}
	/>
</AppShell>
