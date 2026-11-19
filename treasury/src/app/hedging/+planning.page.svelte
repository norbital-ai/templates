<script lang="ts">
	/** Planning: bankers' proposals, pasted or attached; each opens on its alternatives side by side. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:lightbulb"
	title={t('fx.planning.title')}
	description={t('fx.planning.description')}
>
	<Table
		{ctx}
		of="fx_proposal"
		order_by={{ created_at: 'desc' }}
		columns={['title', 'bank', 'read_status', 'created_at']}
		toolbar={{ title: false }}
	/>
</AppShell>
