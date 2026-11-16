<script lang="ts">
	/**
	 * A purchase order: its fields, items and invoices (the generated form), where it stands against its invoices, every
	 * difference an invoice shows against it, and the lines that pay it. Treasury links a line here.
	 */
	import type { PageContext } from '@norbital-ai/bolt/page';
	import {
		Alert,
		Form,
		RecordShell,
		Table,
		type RecordSection,
		type RecordView
	} from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import { invoiceFindings, poStatus } from '../../../lib/purchasing.js';
	let { view, ctx }: { view: RecordView<'purchase_order'>; ctx: PageContext } = $props();
	const t = ctx.t;
	const sections: readonly RecordSection[] = [
		{
			name: 'order',
			icon: 'lucide:clipboard-list',
			title: t('app.sections.order'),
			fields: ['po_number', 'po_date', 'supplier', 'purchaser', 'salesperson', 'currency']
		},
		{
			name: 'items',
			icon: 'lucide:package',
			title: t('app.sections.items'),
			fields: ['lines', 'ship_to_country', 'lc_requested', 'is_cancelled']
		},
		{
			name: 'evidence',
			icon: 'lucide:paperclip',
			title: t('app.sections.evidence'),
			fields: ['documents', 'invoices'],
			default_open: false
		},
		{
			name: 'notes',
			icon: 'lucide:notebook-pen',
			title: t('app.sections.notes'),
			fields: ['notes'],
			default_open: false
		}
	];

	const record = $derived(view.mode === 'create' ? null : view.record);
	const read = $derived.by(() => {
		const id = record?.id;
		if (id === undefined) return null;
		return ctx.query({
			purchase_order: {
				where: { id: { eq: id } },
				fields: ['currency', 'supplier', 'is_cancelled'],
				lines: { fields: ['item', 'quantity', 'amount', 'invoiced_quantity'] },
				invoices: {
					fields: ['invoice_number', 'currency', 'amount', 'drawdown'],
					lines: { fields: ['po_line', 'quantity', 'amount'] },
					drawdown: { fields: ['supplier', 'amount', 'invoiced_amount'] }
				},
				financings: {
					fields: ['drawdown'],
					drawdown: { fields: ['bank_reference', 'product', 'status', 'lc_number', 'due_date'] }
				},
				limit: 1
			}
		});
	});
	const po = $derived(read?.current?.purchase_order.rows[0]);
	const status = $derived(po === undefined ? null : poStatus(po));
	const findings = $derived(
		po === undefined
			? []
			: po.invoices.flatMap((inv) =>
					invoiceFindings(
						inv,
						po,
						inv.drawdown === null
							? null
							: {
									supplier: inv.drawdown.supplier,
									amount: inv.drawdown.amount,
									invoiced: inv.drawdown.invoiced_amount
								}
					).map((f) => ({ ...f, invoice: inv.invoice_number }))
				)
	);
	const financings = $derived(
		(po?.financings ?? []).map((f) => ({
			bank_reference: f.drawdown?.bank_reference ?? '—',
			product: f.drawdown?.product ?? null,
			status: f.drawdown?.status ?? null,
			lc_number: f.drawdown?.lc_number ?? null,
			due_date: f.drawdown?.due_date ?? null
		}))
	);
</script>

{#snippet checks()}
	<Stack gap="sm">
		{#if status !== null}<p class="text-sm font-semibold">
				{t(`app.orders.status_${status}`)}
			</p>{/if}
		{#if findings.length === 0}
			<p class="text-meta">{t('app.orders.matches')}</p>
		{/if}
		{#each findings as f, i (i)}
			<Alert.Root variant="warning">
				<Alert.Description>{f.invoice}: {t(f.key, f.values)}</Alert.Description>
			</Alert.Root>
		{/each}
	</Stack>
{/snippet}
{#snippet paid()}
	<Stack gap="md">
		<Table
			{ctx}
			of={financings}
			controlled
			embedded
			columns={[
				{ field: 'bank_reference', label: t('app.orders.reference') },
				{ field: 'product', label: t('app.costs.product') },
				{ field: 'status', label: t('app.orders.status') },
				{ field: 'lc_number', label: t('app.orders.lc_number') },
				{ field: 'due_date', label: t('app.orders.due'), kind: { kind: 'date' } }
			]}
		/>
		{#if record !== null}
			<Form
				{ctx}
				of="po_financing"
				mode="create"
				values={{ purchase_order: record.id }}
				fields={['drawdown']}
				submit={t('app.orders.link')}
			/>
		{/if}
	</Stack>
{/snippet}

{#if record === null}
	<RecordShell
		{ctx}
		of="purchase_order"
		{sections}
		mode="create"
		values={view.mode === 'create' ? view.values : {}}
	/>
{:else}
	<RecordShell
		{ctx}
		of="purchase_order"
		{sections}
		id={record.id}
		subtitle={['supplier', 'po_date']}
		tabs={[
			{ name: 'checks', title: t('app.orders.checks'), icon: 'lucide:list-checks', body: checks },
			{
				name: 'financing',
				title: t('app.orders.financing'),
				icon: 'lucide:landmark',
				body: paid,
				keep_alive: true
			}
		]}
	/>
{/if}
