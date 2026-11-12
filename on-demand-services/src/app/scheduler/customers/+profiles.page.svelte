<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	let { ctx }: { ctx: PageContext } = $props();
	/** Every customer and their default address. Open one for their bookings and what they were told. */
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:house"
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
