<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:id-card"
	title={ctx.t('section.profiles')}
	description={ctx.t('settings.profiles.description')}
>
	<Table
		{ctx}
		of="user_profiles"
		toolbar={{ title: ctx.t('section.profiles') }}
		order_by="name"
		columns={[
			'name',
			'user_id',
			'kingdee_employee_id',
			'kingdee_department_id',
			'kingdee_biller_id',
			'kingdee_customer_id',
			'phone'
		]}
	/>
</AppShell>
