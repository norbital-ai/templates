<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:gauge"
	title={t('app.limits.title')}
	description={t('app.limits.description')}
>
	<Table
		{ctx}
		of="facility"
		initial_filter={{ status: { eq: 'active' } }}
		columns={[
			'name',
			'bank',
			'currency',
			'limit',
			'status',
			'max_tenor_days',
			'review_date',
			'expiry_date'
		]}
		toolbar={{ title: false }}
	/>
</AppShell>
