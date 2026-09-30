<script lang="ts">
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';

	let { view }: { view: RecordView<'purchase_invoice_lines'> } = $props();
</script>

<!-- the invoiceable lines are the invoice's own order's -->
{#snippet orderLine(form: FormState)}
	{@const invoice = form.get('purchase_invoice_id')}
	{@const chosen = form.get('purchase_order_line_id')}
	<Picker
		of="purchase_order_lines"
		value={typeof chosen === 'string' ? (chosen as Id<'purchase_order_lines'>) : null}
		onChange={(id) => form.set('purchase_order_line_id', id)}
		{...typeof invoice === 'string'
			? {
					where: {
						purchase_order_id: {
							is: {
								purchase_invoices: {
									some: { id: { eq: invoice as Id<'purchase_invoices'> } }
								}
							}
						}
					}
				}
			: {}}
	/>
{/snippet}

<RecordForm
	{view}
	subtitle={['purchase_invoice_id']}
	editors={{ purchase_order_line_id: orderLine }}
	fields={['purchase_invoice_id', 'purchase_order_line_id', 'quantity', 'unit_cost', 'tax_rate']}
/>
