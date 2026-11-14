import { app } from '@norbital-ai/bolt';
/** Purchasing: purchase orders raised on suppliers, with their item lines and invoices. */
export default app({
	title: 'Purchasing',
	description: 'Puchase orders and the invoices recorded against them.',
	icon: 'lucide:file-text',
	pages: {
		purchase_orders: { title: 'Purchase orders', icon: 'lucide:file-text' }
	}
});
