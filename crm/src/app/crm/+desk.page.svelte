<script lang="ts">
	/**
	 * The sales desk, scoped to one account (the picker in the header; the first active account by name until one is
	 * chosen): the pipeline board with a rep filter, then the account's quotes, contacts, activities, invoices, contracts
	 * and payments, beside the account and product books. A document's lines are a tab of its record.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { EmptyState, Picker, Show } from '@norbital-ai/ui';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { Board, Table } from '@norbital-ai/ui';
	import { num } from '../../lib/pricing.js';
	import Ref from '../../lib/ui/ref.svelte';
	import DocLink from '../../lib/ui/doc-link.svelte';

	const t = bolt.t;
	let account = $state<Id<'accounts'> | null>(null);
	let owner = $state<Id<'sys_user'> | null>(null);
	bolt
		.read('accounts', {
			where: { active: { eq: true } },
			orderBy: { name: 'asc' },
			limit: 1
		})
		.then(
			(page) => (account ??= page.rows[0]?.id ?? null),
			() => {} // a holder with no `accounts` read picks no account
		);

	/** The chosen account's rows; none before one is chosen (the tabs render only once one is). */
	const onAccount = $derived({ account_id: { in: account === null ? [] : [account] } });
	const onQuote = $derived({ quote_id: { is: onAccount } });
	const money = { kind: 'money', currency: 'currency' } as const;
	const lanes = (['draft', 'sent', 'won', 'confirmed', 'lost'] as const).map((value) => ({
		value,
		label: t(`component.status_${value}`)
	}));
</script>

<!-- an arc column shows its row's label (`lib/ui/ref.svelte`); a one-relation column does by default -->
{#snippet regarding({ value }: { value: unknown })}<Ref id={value} />{/snippet}
<!-- a document's number opens it -->
{#snippet quoteNo({ row, value }: { row: { id: unknown }; value: unknown })}<DocLink
		of="quotes"
		{row}
		{value}
	/>{/snippet}
{#snippet invoiceNo({ row, value }: { row: { id: unknown }; value: unknown })}<DocLink
		of="sales_invoices"
		{row}
		{value}
	/>{/snippet}

{#snippet ownerFilter()}
	<Picker of="sys_user" label={['name']} value={owner} onChange={(id) => (owner = id)} />
{/snippet}
{#snippet quoteCard({ row }: { row: { [f: string]: unknown } })}
	<span class="font-medium">{row['doc_no']}</span>
	<span class="text-meta">{row['title']}</span>
	<span class="text-meta"><Show kind={money} value={row['gross']} {row} /></span>
{/snippet}
{#snippet pipeline()}
	<Board
		of="quotes"
		by="status"
		{lanes}
		key="pipeline"
		card={quoteCard}
		toolbar={{ title: t('app.crm.tab_pipeline'), controls: ownerFilter }}
		where={owner ? { ...onAccount, owner_id: { eq: owner } } : onAccount}
	/>
{/snippet}
{#snippet quotes()}
	<Table
		of="quotes"
		key="quotes"
		toolbar={{ title: t('app.crm.tab_quotes') }}
		where={onAccount}
		orderBy={{ doc_no: 'desc' }}
		columns={[
			{ field: 'doc_no', label: t('component.doc_no'), cell: quoteNo },
			'title',
			'status',
			{ field: 'gross', label: t('component.amount') },
			{ field: 'valid_until', label: t('component.valid_until') },
			{ field: 'confirmed_at', label: t('component.confirmed') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet accounts()}
	<Table
		of="accounts"
		key="accounts"
		toolbar={{ title: t('app.crm.tab_accounts') }}
		where={{ active: { eq: true } }}
		orderBy={{ name: 'asc' }}
		columns={[
			'name',
			'industry',
			'phone',
			'currency',
			{ field: 'credit_limit', label: t('component.credit_available'), cell: creditCell },
			'active'
		]}
	/>
{/snippet}
{#snippet creditCell({ row }: { row: { [f: string]: unknown } })}{#if row.credit_hold === true}{t(
			'component.hold'
		)}{:else if row.credit_limit == null}—{:else}<Show
			kind={money}
			value={num(row.credit_limit) - num(row.credit_used ?? 0)}
			{row}
		/>{/if}{/snippet}
{#snippet contacts()}
	<Table
		of="contacts"
		key="contacts"
		toolbar={{ title: t('app.crm.tab_contacts') }}
		where={{ ...onAccount, active: { eq: true } }}
		orderBy={{ first_name: 'asc' }}
		columns={[
			{ field: 'first_name', label: t('component.first_name') },
			{ field: 'last_name', label: t('component.last_name') },
			'email',
			'title',
			'department',
			'active'
		]}
	/>
{/snippet}
{#snippet products()}
	<Table
		of="products"
		key="products"
		toolbar={{ title: t('app.crm.tab_products') }}
		where={{ active: { eq: true } }}
		orderBy={{ name: 'asc' }}
		columns={[
			'code',
			'name',
			'spec',
			'unit',
			{ field: 'qty_on_hand', label: t('component.on_hand') },
			{ field: 'unit_price', label: t('component.unit_price') },
			'active'
		]}
	/>
{/snippet}
{#snippet activities()}
	<Table
		of="activities"
		key="activities"
		toolbar={{ title: t('app.crm.tab_activities') }}
		where={{
			or: [
				{ regarding: { accounts: onAccount.account_id } },
				{ regarding: { quotes: { is: onAccount } } }
			]
		}}
		orderBy={{ due_date: 'desc' }}
		columns={[
			'subject',
			'type',
			{ field: 'regarding', label: t('component.regarding'), cell: regarding },
			{ field: 'due_date', label: t('component.due') },
			{ field: 'completed_at', label: t('component.completed') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet billing()}
	<Table
		of="sales_invoices"
		key="billing"
		toolbar={{ title: t('app.crm.billing_title') }}
		where={onAccount}
		orderBy={{ doc_no: 'desc' }}
		columns={[
			{ field: 'doc_no', label: t('component.doc_no'), cell: invoiceNo },
			{ field: 'quote_id', label: t('component.quote') },
			'status',
			{ field: 'gross', label: t('component.gross_amount') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet contracts()}
	<Table
		of="contract_signings"
		key="contracts"
		toolbar={{ title: t('app.crm.contracts_title') }}
		where={onQuote}
		columns={[
			{ field: 'quote_id', label: t('component.quote') },
			'variant',
			'status',
			{ field: 'acknowledged_at', label: t('component.acknowledged') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet payments()}
	<Table
		of="settlements"
		key="payments"
		toolbar={{ title: t('app.crm.payments_title') }}
		where={{ regarding: { quotes: { is: onAccount } } }}
		columns={[
			{ field: 'regarding', label: t('component.quote'), cell: regarding },
			'amount',
			{ field: 'settled_on', label: t('component.settled_on') },
			'reference'
		]}
	/>
{/snippet}

<AppShell
	icon="lucide:handshake"
	title={t('app.crm.title')}
	description={t('app.crm.description')}
	variant="full"
>
	{#snippet actions()}
		<Picker
			of="accounts"
			value={account}
			where={{ active: { eq: true } }}
			orderBy={{ name: 'asc' }}
			onChange={(id) => (account = id)}
		/>
	{/snippet}
	{#if account === null}
		<EmptyState title={t('app.crm.select_account')} />
	{:else}
		<Tabs
			tabs={[
				{
					name: 'pipeline',
					title: t('app.crm.tab_pipeline'),
					icon: 'lucide:kanban',
					body: pipeline
				},
				{ name: 'quotes', title: t('app.crm.tab_quotes'), icon: 'lucide:file-text', body: quotes },
				{
					name: 'accounts',
					title: t('app.crm.tab_accounts'),
					icon: 'lucide:building-2',
					body: accounts
				},
				{
					name: 'contacts',
					title: t('app.crm.tab_contacts'),
					icon: 'lucide:contact-round',
					body: contacts
				},
				{
					name: 'products',
					title: t('app.crm.tab_products'),
					icon: 'lucide:package',
					body: products
				},
				{
					name: 'activities',
					title: t('app.crm.tab_activities'),
					icon: 'lucide:calendar-check',
					body: activities
				},
				{
					name: 'billing',
					title: t('app.crm.billing_title'),
					icon: 'lucide:file-text',
					body: billing
				},
				{
					name: 'contracts',
					title: t('app.crm.contracts_title'),
					icon: 'lucide:file-signature',
					body: contracts
				},
				{
					name: 'payments',
					title: t('app.crm.payments_title'),
					icon: 'lucide:banknote',
					body: payments
				}
			]}
		/>
	{/if}
</AppShell>
