<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';

	let { view }: { view: RecordView<'sales_invoice_lines'> } = $props();
	const t = bolt.t;
</script>

<!-- the billable lines are the invoice's own quote's -->
{#snippet quoteLine(form: FormState)}
	{@const invoice = form.get('sales_invoice_id')}
	{@const chosen = form.get('quote_line_id')}
	<Picker
		of="quote_lines"
		value={typeof chosen === 'string' ? (chosen as Id<'quote_lines'>) : null}
		onChange={(id) => form.set('quote_line_id', id)}
		{...typeof invoice === 'string'
			? {
					where: {
						quote_id: {
							is: { sales_invoices: { some: { id: { eq: invoice as Id<'sales_invoices'> } } } }
						}
					}
				}
			: {}}
	/>
{/snippet}

<RecordForm
	{view}
	subtitle={['sales_invoice_id']}
	editors={{ quote_line_id: quoteLine }}
	sections={[
		{
			name: 'line',
			title: t('section.line'),
			fields: ['sales_invoice_id', 'quote_line_id', 'quantity', 'unit_price', 'tax_rate']
		}
	]}
/>
