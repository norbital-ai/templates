<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { RecordShell, Sheet, Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	let createRole = $state<'client' | 'supplier' | 'subcontractor' | null>(null);
	const canCreate = $derived(ctx.catalog?.contacts?.create !== undefined);

	const cols = [
		'company_name',
		'full_name',
		'role',
		'trade_specialty',
		'phone',
		'email',
		'payment_terms_days',
		'status'
	] as const;
</script>

{#snippet allPartners()}
	<Table
		{ctx}
		of="contacts"
		key="partners:all"
		order_by={{ company_name: 'asc' }}
		toolbar={{
			title: t('partners.tab_all'),
			new: canCreate ? () => (createRole = 'subcontractor') : false
		}}
		columns={[...cols]}
	/>
{/snippet}

{#snippet customers()}
	<Table
		{ctx}
		of="contacts"
		key="partners:customers"
		where={{ role: { in: ['client', 'main_contractor'] } }}
		order_by={{ company_name: 'asc' }}
		toolbar={{
			title: t('partners.tab_customers'),
			new: canCreate ? () => (createRole = 'client') : false
		}}
		columns={[...cols]}
	/>
{/snippet}

{#snippet vendors()}
	<Table
		{ctx}
		of="contacts"
		key="partners:vendors"
		where={{ role: { eq: 'supplier' } }}
		order_by={{ company_name: 'asc' }}
		toolbar={{
			title: t('partners.tab_vendors'),
			new: canCreate ? () => (createRole = 'supplier') : false
		}}
		columns={[...cols]}
	/>
{/snippet}

{#snippet subcontractors()}
	<Table
		{ctx}
		of="contacts"
		key="partners:subcontractors"
		where={{ role: { eq: 'subcontractor' } }}
		order_by={{ company_name: 'asc' }}
		toolbar={{
			title: t('partners.tab_subcontractors'),
			new: canCreate ? () => (createRole = 'subcontractor') : false
		}}
		columns={[...cols]}
	/>
{/snippet}

<AppShell
	icon="lucide:handshake"
	title={t('partners.title')}
	description={t('partners.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'all', title: t('partners.tab_all'), icon: 'lucide:users', body: allPartners },
			{
				name: 'customers',
				title: t('partners.tab_customers'),
				icon: 'lucide:building-2',
				body: customers
			},
			{ name: 'vendors', title: t('partners.tab_vendors'), icon: 'lucide:package', body: vendors },
			{
				name: 'subcontractors',
				title: t('partners.tab_subcontractors'),
				icon: 'lucide:hard-hat',
				body: subcontractors
			}
		]}
	/>
</AppShell>

<Sheet open={createRole !== null} on_open_change={(open) => !open && (createRole = null)}>
	{#if createRole !== null}
		<RecordShell
			{ctx}
			of="contacts"
			mode="create"
			values={{ role: createRole }}
			on_done={() => (createRole = null)}
		/>
	{/if}
</Sheet>
