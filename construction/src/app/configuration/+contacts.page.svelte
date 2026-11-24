<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';

	let { ctx }: { ctx: PageContext } = $props();
</script>

<AppShell
	icon="lucide:contact-round"
	title={ctx.t('contacts.title')}
	description={ctx.t('contacts.description')}
>
	<Table
		{ctx}
		of="contacts"
		toolbar={{ title: false }}
		columns={[
			'full_name',
			'company_name',
			'role',
			'trade_specialty',
			'project_id',
			'phone',
			'email',
			'status'
		]}
	/>
</AppShell>
