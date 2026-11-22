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
	icon="lucide:gauge"
	title={t('app.limits.title')}
	description={t('app.limits.description')}
>
	<Table
		{ctx}
		of="facility"
		initial_filter={{ status: { eq: 'active' } }}
		columns={[
			'name',
			'bank',
			{
				field: 'limit',
				kind: { kind: 'money', currency: 'currency' },
				align: 'end',
				cell: moneyCell
			},
			'status',
			'max_tenor_days',
			'review_date',
			'expiry_date'
		]}
		toolbar={{ title: false }}
	/>
</AppShell>
