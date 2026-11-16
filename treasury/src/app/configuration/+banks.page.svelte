<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:landmark"
	title={t('app.banks.title')}
	description={t('app.banks.description')}
>
	<Table
		{ctx}
		of="bank"
		initial_filter={{ is_active: { eq: true } }}
		columns={['code', 'name', 'cut_off_time', 'offered_products', 'is_active']}
		toolbar={{ title: false }}
	/>
</AppShell>
