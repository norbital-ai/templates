<script lang="ts">
	/**
	 * A quote: its number, total and terms, the contact picked from the chosen account's people, its lines (added here
	 * while it is a draft), and the export once confirmed.
	 */
	import { bolt } from '$bolt';
	import { Picker, RecordShell, Table } from '@norbital-ai/ui';
	import { Stack } from '@norbital-ai/ui/layout';
	import type { RecordView } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import ExportRun from '../../../lib/ui/export-run.svelte';

	let { view }: { view: RecordView<'quotes'> } = $props();
	const t = bolt.t;
</script>

{#snippet lines()}
	{#if view.mode === 'update'}
		<Stack gap="md">
			<Table
				of="quote_lines"
				key="quote-lines-of"
				toolbar={{ new: false }}
				where={{ quote_id: { eq: view.record.id } }}
				columns={[
					{ field: 'product_code', label: t('component.code') },
					{ field: 'product_name', label: t('component.product') },
					'quantity',
					{ field: 'unit_price', label: t('component.unit_price') },
					{ field: 'discount_pct', label: t('component.discount_pct') },
					{ field: 'tax_rate', label: t('component.tax_rate') },
					{ field: 'line_total', label: t('component.total') }
				]}
			/>
			{#if view.record.status === 'draft'}<RecordShell
					of="quote_lines"
					mode="create"
					values={{ quote_id: view.record.id }}
				/>{/if}
		</Stack>
	{/if}
{/snippet}

{#snippet contact(form: import('@norbital-ai/ui').FormState)}
	{@const account = form.get('account_id')}
	{@const chosen = form.get('contact_id')}
	<Picker
		of="contacts"
		value={typeof chosen === 'string' ? chosen : null}
		onChange={(id) => form.set('contact_id', id)}
		{...typeof account === 'string'
			? { where: { account_id: { eq: account as Id<'accounts'> } } }
			: {}}
		orderBy={{ last_name: 'asc' }}
	/>
{/snippet}
{#snippet actions()}
	{#if view.mode === 'update' && view.record.status === 'confirmed'}<ExportRun
			collection="quotes"
			id={view.record.id}
		/>{/if}
{/snippet}

<RecordForm
	{view}
	{actions}
	subtitle={['account_id', 'status']}
	tabs={[{ name: 'lines', title: t('component.lines'), body: lines }]}
	editors={{ contact_id: contact }}
	fields={[
		'account_id',
		'contact_id',
		'title',
		'status',
		'currency',
		'tax_inclusive',
		'valid_until',
		'payment_terms',
		'shipping_terms',
		'place_of_loading',
		'place_of_delivery',
		'packaging',
		'shipping_mark',
		'time_of_shipment',
		'other_terms',
		'owner_id',
		'credit_acknowledged',
		'cancel_reason',
		'description'
	]}
/>
