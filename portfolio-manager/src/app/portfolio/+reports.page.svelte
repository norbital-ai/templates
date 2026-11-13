<script lang="ts">
	/** One report per day, written by the agent; open a row for the full report. A reader subscribes here. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Button, Table, toast } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { fork } from '@norbital-ai/ui/effect';
	let { ctx }: { ctx: PageContext } = $props();

	/** The reader's own subscription row, if any: the one button's state. */
	const mine = ctx.query({
		report_subscription: { where: { user: { eq: { var: 'requestor.id' } } }, limit: 1 }
	});
	const subscription = $derived(mine.current?.report_subscription.rows[0] ?? null);
	/** The query is live: the button follows the row once the write commits. */
	const failed = (error: unknown) =>
		toast.error(error instanceof Error ? error.message : String(error));
	const toggle = () =>
		subscription === null
			? fork(ctx.act({ 'report_subscription.create': [{}] }), failed)
			: fork(ctx.act({ 'report_subscription.delete': [{ target: subscription }] }), failed);
</script>

{#snippet subscribe()}
	{#if mine.current}
		<Button variant="outline" onclick={toggle}>
			{ctx.t(subscription === null ? 'component.subscribe' : 'component.unsubscribe')}
		</Button>
	{/if}
{/snippet}

<AppShell
	title="Reports"
	description="One report per day: the lead, the markets and a section on each line with cited news."
	icon="lucide:newspaper"
	actions={subscribe}
>
	<Table
		{ctx}
		of="report"
		order_by={{ for_date: 'desc' }}
		columns={['for_date', 'headline', 'net_assets', 'day_change', 'market_view']}
		toolbar={{ title: 'Reports', new: false }}
	/>
</AppShell>
