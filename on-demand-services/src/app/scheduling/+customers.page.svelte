<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t = (...args: Parameters<PageContext['t']>) => ctx.t(...args);
</script>

<AppShell
	icon="lucide:contact"
	title={t('app.customers.title')}
	description={t('app.customers.description')}
>
	<Table
		{ctx}
		of="customers"
		order_by={{ name: 'asc' }}
		toolbar={{ title: t('app.customers.tab_profiles') }}
		columns={['name', 'phone', 'email', 'address']}
	/>
</AppShell>
