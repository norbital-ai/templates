<script lang="ts">
	/**
	 * The sales desk, scoped to one account (the picker beside the tabs; the first active account by name until one is
	 * chosen):
	 * the pipeline board with a rep filter, then the account's quotes, lines, contacts, activities, invoices, invoice
	 * lines, contracts and payments, beside the account and product books.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Picker } from '@norbital-ai/ui';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Tabs } from '@norbital-ai/ui';
	import { Board, Table } from '@norbital-ai/ui';
	import { num } from '../../lib/pricing.js';
	import Ref from '../../lib/ui/ref.svelte';

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
	const lanes = (['draft', 'sent', 'won', 'confirmed', 'lost'] as const).map((value) => ({
		value,
		label: t(`component.status_${value}`)
	}));
	const credit = (row: { [f: string]: unknown }) =>
		row.credit_hold === true
			? t('component.hold')
			: row.credit_limit == null
				? '—'
				: (num(row.credit_limit) - num(row.credit_used ?? 0)).toLocaleString();
</script>

<!-- an arc column shows its row's label (`lib/ui/ref.svelte`); a one-relation column does by default -->
{#snippet regarding({ value }: { value: unknown })}<Ref id={value} />{/snippet}

{#snippet pipeline()}
	<Stack gap="md">
		<Stack as="label" gap="xs" class="max-w-72 text-sm">
			<span class="font-medium">{t('component.owner')}</span>
			<Picker of="sys_user" label={['name']} value={owner} onChange={(id) => (owner = id)} />
		</Stack>
		<Board
			of="quotes"
			by="status"
			{lanes}
			key="pipeline"
			card={['doc_no', 'title', 'currency', 'gross']}
			where={owner ? { ...onAccount, owner_id: { eq: owner } } : onAccount}
		/>
	</Stack>
{/snippet}
{#snippet quotes()}
	<Table
		of="quotes"
		key="quotes"
		toolbar={{ title: t('app.crm.tab_quotes') }}
		where={onAccount}
		orderBy={{ doc_no: 'desc' }}
		columns={[
			'doc_no',
			'title',
			'status',
			{ field: 'gross', label: t('component.amount') },
			'currency',
			{ field: 'valid_until', label: t('component.valid_until') },
			{ field: 'confirmed_at', label: t('component.confirmed') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet quoteLines()}
	<Table
		of="quote_lines"
		key="quote_lines"
		toolbar={{ title: t('app.crm.tab_quote_lines') }}
		where={onQuote}
		columns={[
			{ field: 'quote_id', label: t('component.quote') },
			{ field: 'product_code', label: t('component.code') },
			{ field: 'product_name', label: t('component.product') },
			'quantity',
			{ field: 'unit_price', label: t('component.unit_price') },
			{ field: 'discount_pct', label: t('component.discount_pct') },
			{ field: 'line_total', label: t('component.total') }
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
{#snippet creditCell({ row }: { row: { [f: string]: unknown } })}{credit(row)}{/snippet}
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
			{ field: 'doc_no', label: t('component.doc_no') },
			{ field: 'quote_id', label: t('component.quote') },
			'status',
			'currency',
			{ field: 'gross', label: t('component.gross_amount') },
			{ field: 'owner_id', label: t('component.owner') }
		]}
	/>
{/snippet}
{#snippet billingLines()}
	<Table
		of="sales_invoice_lines"
		key="billing_lines"
		toolbar={{ title: t('app.crm.billing_lines_title') }}
		where={{ sales_invoice_id: { is: onAccount } }}
		columns={[
			{ field: 'sales_invoice_id', label: t('component.invoice') },
			{ field: 'product_code', label: t('component.code') },
			{ field: 'product_name', label: t('component.product') },
			'quantity',
			{ field: 'unit_price', label: t('component.unit_price') },
			{ field: 'line_total', label: t('component.total') }
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
			'currency',
			{ field: 'settled_on', label: t('component.settled_on') },
			'reference'
		]}
	/>
{/snippet}

{#snippet accountPicker()}
	<div class="min-w-64">
		<Picker
			of="accounts"
			value={account}
			where={{ active: { eq: true } }}
			orderBy={{ name: 'asc' }}
			onChange={(id) => (account = id)}
		/>
	</div>
{/snippet}

<AppShell
	icon="lucide:handshake"
	title={t('app.crm.title')}
	description={t('app.crm.header_description')}
	variant="full"
>
	{#if account === null}
		<Stack gap="sm">
			{@render accountPicker()}
			<p class="text-sm text-muted-foreground">{t('app.crm.select_account')}</p>
		</Stack>
	{:else}
		<Tabs
			trailing={accountPicker}
			tabs={[
				{
					name: 'pipeline',
					title: t('app.crm.tab_pipeline'),
					icon: 'lucide:kanban',
					body: pipeline
				},
				{ name: 'quotes', title: t('app.crm.tab_quotes'), icon: 'lucide:file-text', body: quotes },
				{
					name: 'quote-lines',
					title: t('app.crm.tab_quote_lines'),
					icon: 'lucide:list-checks',
					body: quoteLines
				},
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
					name: 'billing-lines',
					title: t('app.crm.billing_lines_title'),
					icon: 'lucide:list-checks',
					body: billingLines
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
