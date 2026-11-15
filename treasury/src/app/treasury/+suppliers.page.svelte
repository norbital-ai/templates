<script lang="ts">
	/**
	 * The supplier list (names as the bank writes them, other spellings as aliases) and which banks accept invoice
	 * financing for each. Treasury ticks the banks in a supplier's record.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { Table, Tabs } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	let { ctx }: { ctx: PageContext } = $props();
	const t = ctx.t;
	const read = ctx.query({
		supplier: {
			where: { is_active: { eq: true } },
			fields: ['name'],
			eligible_banks: { fields: ['bank'], bank: { fields: ['code'] } }
		},
		bank: { where: { is_active: { eq: true } }, fields: ['code'], order_by: { code: 'asc' } }
	});
	const banks = $derived(read.current?.bank.rows ?? []);
	const grid = $derived<Record<string, string>[]>(
		(read.current?.supplier.rows ?? []).map((s) => ({
			supplier: s.name,
			...Object.fromEntries(
				banks.map((b) => [b.code, s.eligible_banks.some((e) => e.bank?.code === b.code) ? '✓' : ''])
			)
		}))
	);
</script>

{#snippet list()}
	<Table
		{ctx}
		of="supplier"
		key="suppliers"
		initial_filter={{ is_active: { eq: true } }}
		columns={['name', 'aliases', 'country', 'payment_terms', 'products', 'eligible_banks']}
		toolbar={{ title: t('app.suppliers.list') }}
	/>
{/snippet}
{#snippet acceptance()}
	<Table
		{ctx}
		of={grid}
		controlled
		columns={[
			{ field: 'supplier', label: t('app.suppliers.supplier') },
			...banks.map((b) => ({ field: b.code, label: b.code }))
		]}
		toolbar={{ title: t('app.suppliers.acceptance') }}
	/>
{/snippet}

<AppShell
	icon="lucide:truck"
	title={t('app.suppliers.title')}
	description={t('app.suppliers.description')}
	variant="full"
>
	<Tabs
		tabs={[
			{ name: 'list', title: t('app.suppliers.list'), icon: 'lucide:truck', body: list },
			{
				name: 'acceptance',
				title: t('app.suppliers.acceptance'),
				icon: 'lucide:grid-3x3',
				body: acceptance
			}
		]}
	/>
</AppShell>
