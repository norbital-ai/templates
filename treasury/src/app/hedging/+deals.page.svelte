<script lang="ts">
	/**
	 * Structures: the deals (live and to confirm first) and the hedge documents still to check. New on documents
	 * uploads a term sheet, confirmation or notice; reading files it with its deal or makes the deal to confirm.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

<AppShell icon="lucide:layers" title={t('fx.deals.title')} description={t('fx.deals.description')}>
	<Stack gap="lg">
		<Table
			{ctx}
			of="fx_deal"
			order_by={{ trade_date: 'desc' }}
			initial_filter={{ status: { in: ['draft', 'live'] } }}
			columns={[
				'bank',
				'bank_reference',
				'pair',
				'structure',
				'side',
				'strike',
				'knock_out',
				'trade_date',
				'status'
			]}
			toolbar={{ title: false }}
		/>
		<Table
			{ctx}
			of="fx_document"
			order_by={{ created_at: 'desc' }}
			initial_filter={{ read_status: { in: ['uploaded', 'checked', 'failed'] } }}
			columns={['kind', 'bank', 'bank_reference', 'trade_date', 'deal', 'read_status']}
		/>
	</Stack>
</AppShell>
