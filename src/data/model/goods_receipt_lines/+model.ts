import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One received quantity against one purchase order line. Partial deliveries arrive as further receipts; the cumulative received quantity is capped at the ordered quantity, so an over-delivery is a conversation, not a silent row.',
	icon: 'lucide:list-checks',
	label: 'quantity_received',
	fields: { quantity_received: { kind: 'decimal', scale: 3 } },
	check: { positive: { quantity_received: { gt: 0 } } }
});
