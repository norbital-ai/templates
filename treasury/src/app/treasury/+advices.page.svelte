<script lang="ts">
	/**
	 * Bank advices: drop the PDFs in (New), read them, check each one's figures beside the PDF in its record, then apply
	 * it to its line. Nothing reaches a line until it is applied.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const COLUMNS = [
		'advice_reference',
		'bank',
		'doc_type',
		'advice_date',
		'drawdown',
		'read_status'
	] as const;
</script>

{#snippet inbox()}
	<Table
		{ctx}
		of="bank_document"
		key="inbox"
		where={{ read_status: { in: ['uploaded', 'checked', 'failed'] } }}
		order_by={{ advice_date: 'desc' }}
		columns={COLUMNS}
		toolbar={{ title: t('app.advices.inbox') }}
		actions={[
			{
				label: t('app.advices.read'),
				run: (row) => ctx.run('bank_document_read', { advice: [row.id] })
			},
			{
				label: t('app.advices.apply'),
				run: (row) => ctx.run('bank_document_apply', { advice: [row.id] })
			}
		]}
	/>
{/snippet}
{#snippet applied()}
	<Table
		{ctx}
		of="bank_document"
		key="applied"
		where={{ read_status: { eq: 'applied' } }}
		order_by={{ advice_date: 'desc' }}
		columns={COLUMNS}
		toolbar={{ title: t('app.advices.applied'), new: false }}
	/>
{/snippet}

<AppShell
	icon="lucide:file-scan"
	title={t('app.advices.title')}
	description={t('app.advices.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'inbox', title: t('app.advices.inbox'), icon: 'lucide:inbox', body: inbox },
			{
				name: 'applied',
				title: t('app.advices.applied'),
				icon: 'lucide:check-check',
				body: applied
			}
		]}
	/>
</AppShell>
