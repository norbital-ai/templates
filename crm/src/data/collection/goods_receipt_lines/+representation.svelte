<script lang="ts">
	import { bolt } from '$bolt';
	import RecordForm from '../../../lib/ui/record-form.svelte';
	import type { FormState, RecordView } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import type { Id } from '@norbital-ai/bolt';

	let { view }: { view: RecordView<'goods_receipt_lines'> } = $props();
	const t = bolt.t;
</script>

<!-- the receivable lines are the receipt's own order's -->
{#snippet orderLine(form: FormState)}
	{@const receipt = form.get('goods_receipt_id')}
	{@const chosen = form.get('purchase_order_line_id')}
	<Picker
		of="purchase_order_lines"
		value={typeof chosen === 'string' ? (chosen as Id<'purchase_order_lines'>) : null}
		onChange={(id) => form.set('purchase_order_line_id', id)}
		{...typeof receipt === 'string'
			? {
					where: {
						purchase_order_id: {
							is: { goods_receipts: { some: { id: { eq: receipt as Id<'goods_receipts'> } } } }
						}
					}
				}
			: {}}
	/>
{/snippet}

<RecordForm
	{view}
	subtitle={['goods_receipt_id']}
	editors={{ purchase_order_line_id: orderLine }}
	sections={[
		{
			name: 'line',
			title: t('section.line'),
			fields: ['goods_receipt_id', 'purchase_order_line_id', 'quantity_received']
		}
	]}
/>
