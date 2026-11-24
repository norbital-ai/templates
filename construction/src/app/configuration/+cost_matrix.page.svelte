<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:table-2"
	title={ctx.t('cost_matrix.title')}
	description={ctx.t('cost_matrix.description')}
>
	<Table
		{ctx}
		of="cost_matrix"
		initial_filter={{ active: { eq: true } }}
		order_by={{ code: 'asc' }}
		page_size={100}
		toolbar={{ title: false }}
		columns={[
			'code',
			'name',
			'category',
			'discipline',
			'trade_specialty',
			'unit',
			'quantity_basis',
			'unit_rate',
			'waste_factor_pct',
			'active'
		]}
	/>
</AppShell>
