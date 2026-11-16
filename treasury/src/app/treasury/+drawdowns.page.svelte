<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

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
			'currency',
			'amount',
			'due_date'
		]}
		toolbar={{ title: false }}
	/>
</AppShell>
