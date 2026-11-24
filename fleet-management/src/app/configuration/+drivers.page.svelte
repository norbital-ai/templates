<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:user-round"
	title={ctx.t('app.configuration.page_drivers')}
	description={ctx.t('app.configuration.drivers_description')}
>
	<Table
		{ctx}
		of="drivers"
		order_by={{ employee_code: 'asc' }}
		toolbar={{ title: false }}
		columns={[
			'employee_code',
			'full_name',
			'license_number',
			'license_class',
			'license_expiry',
			'phone',
			'status'
		]}
	/>
</AppShell>
