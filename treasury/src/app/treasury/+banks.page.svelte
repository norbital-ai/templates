<script lang="ts">
	/** The banks with their contacts and terms, the rules to watch at each, and their letters of offer. */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
</script>

{#snippet banks()}
	<Table
		{ctx}
		of="bank"
		key="banks"
		columns={['code', 'name', 'cut_off_time', 'offered_products', 'is_active']}
		toolbar={{ title: t('app.banks.banks') }}
	/>
{/snippet}
{#snippet watch()}
	<Table
		{ctx}
		of="watch_point"
		key="watch"
		initial_filter={{ is_active: { eq: true } }}
		columns={['bank', 'facility', 'category', 'text', 'is_active']}
		toolbar={{ title: t('app.banks.watch_points') }}
	/>
{/snippet}
{#snippet letters()}
	<Table
		{ctx}
		of="letter_of_offer"
		key="letters"
		order_by={{ offer_date: 'desc' }}
		columns={['bank', 'facility', 'title', 'offer_date', 'next_review_date', 'document']}
		toolbar={{ title: t('app.banks.letters') }}
	/>
{/snippet}

<AppShell
	icon="lucide:building-2"
	title={t('app.banks.title')}
	description={t('app.banks.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'banks', title: t('app.banks.banks'), icon: 'lucide:building-2', body: banks },
			{
				name: 'watch',
				title: t('app.banks.watch_points'),
				icon: 'lucide:triangle-alert',
				body: watch
			},
			{
				name: 'letters',
				title: t('app.banks.letters'),
				icon: 'lucide:file-signature',
				body: letters
			}
		]}
	/>
</AppShell>
