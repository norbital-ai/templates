<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:table-2"
	title={ctx.t('item_matrix.title')}
	description={ctx.t('item_matrix.description')}
>
	<Table
		{ctx}
		of="item_matrix"
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
			'carbon_factor',
			'waste_factor_pct',
			'active'
		]}
	/>
</AppShell>
