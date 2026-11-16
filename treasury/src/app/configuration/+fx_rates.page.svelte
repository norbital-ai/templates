<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:arrow-left-right"
	title={t('app.month_end.fx')}
	description={t('app.configuration.fx_description')}
>
	<Table
		{ctx}
		of="fx_rate"
		order_by={{ rate_date: 'desc' }}
		columns={['currency', 'rate_date', 'usd_per_unit', 'is_month_end', 'source']}
		toolbar={{ title: false }}
	/>
</AppShell>
