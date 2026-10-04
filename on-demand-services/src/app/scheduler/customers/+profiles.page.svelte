<script lang="ts">
	/** Every customer and their default address. Open one for their bookings and what they were told. */
	import { bolt } from '$bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	const t = bolt.t;
</script>

<AppShell
	icon="lucide:house"
	title={t('app.customers.title')}
	description={t('app.customers.description')}
>
	<Table
		of="customers"
		orderBy={{ name: 'asc' }}
		toolbar={{ title: t('app.customers.tab_profiles') }}
		columns={['name', 'phone', 'email', 'address']}
	/>
</AppShell>
