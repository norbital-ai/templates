<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';

	let { view }: { view: RecordView<'purchase_invoice_lines'> } = $props();
	const t = bolt.t;
</script>

<!-- the invoiceable lines are the invoice's own order's -->
{#snippet orderLine(form: FormState)}
	{@const invoice = form.id<'purchase_invoices'>('purchase_invoice_id')}
	{@const chosen = form.get('purchase_order_line_id')}
	<Picker
		of="purchase_order_lines"
		value={typeof chosen === 'string' ? chosen : null}
		onChange={(id) => form.set('purchase_order_line_id', id)}
		{...invoice !== null
			? {
					where: {
						purchase_order_id: {
							is: {
								purchase_invoices: {
									some: { id: { eq: invoice } }
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
	sections={[
		{
			name: 'line',
			title: t('section.line'),
			fields: ['purchase_invoice_id', 'purchase_order_line_id', 'quantity', 'unit_cost', 'tax_rate']
		}
	]}
/>
