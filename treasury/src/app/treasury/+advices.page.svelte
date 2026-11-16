<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell
	icon="lucide:file-scan"
	title={t('app.advices.title')}
	description={t('app.advices.description')}
>
	<Table
		{ctx}
		of="bank_document"
		order_by={{ created_at: 'desc' }}
		columns={['advice_reference', 'bank', 'doc_type', 'advice_date', 'drawdown', 'read_status']}
		toolbar={{ title: false }}
	/>
</AppShell>
