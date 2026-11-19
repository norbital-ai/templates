<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:contact-round"
	title={t('app.partners.title')}
	description={t('app.partners.description')}
>
	<Table
		{ctx}
		of="business_partner"
		columns={['name', 'role', 'country', 'payment_terms', 'eligible_banks']}
		toolbar={{ title: false }}
	/>
</AppShell>
