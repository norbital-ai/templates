<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { EmptyState, Table, TableSkeleton, open_record } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { ATTENTION_READ, attention } from '../../lib/attention.js';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const day = ctx.clock('day');
	const read = ctx.query(ATTENTION_READ);
	const items = $derived(
		read.current === undefined
			? []
			: attention(read.current, day.today).map((item) => ({
					...item,
					reasons: item.reasons.map((key) => t(key)).join(' · ')
				}))
	);
</script>

<AppShell
	icon="lucide:bell"
	title={t('app.alerts.title')}
	description={t('app.alerts.description')}
>
	{#if read.error}
		<EmptyState title={t('app.dashboard.error')} hint={String(read.error)} />
	{:else if read.current === undefined}
		<div aria-busy="true"><TableSkeleton /></div>
	{:else}
		<Table
			{ctx}
			of={items}
			toolbar={{ title: false, new: false }}
			columns={[
				{ field: 'reference', label: t('app.attention.reference') },
				{ field: 'reasons', label: t('app.attention.reasons') },
				{ field: 'date', label: t('app.orders.due'), kind: { kind: 'date' } },
				{
					field: 'amount',
					label: t('app.line.amount'),
					kind: { kind: 'money', currency: 'currency' },
					align: 'end'
				}
			]}
			on_open={(item) => open_record(item.model, item.id)}
		/>
	{/if}
</AppShell>
