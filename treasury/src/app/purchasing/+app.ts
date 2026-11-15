import { app } from '@norbital-ai/bolt';
/** Purchasing: purchase orders raised on suppliers with their invoices, and the facility forms that pay them. */
export default app({
	title: 'Purchasing',
	description: 'Purchase orders, the invoices recorded against them, and facility forms.',
	icon: 'lucide:file-text',
	pages: {
		purchase_orders: { title: 'Purchase orders', icon: 'lucide:file-text' },
		facility_forms: { title: 'Facility forms', icon: 'lucide:file-signature' }
	}
});
