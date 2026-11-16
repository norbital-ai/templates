import { app } from '@norbital-ai/bolt';
/** Purchasing: purchase orders raised on suppliers with their invoices, and their financing requests. */
export default app({
	title: 'Purchasing',
	description: 'Purchase orders, financing requests and business partners.',
	icon: 'lucide:file-text',
	banner: 'app-media/purchasing.webp',
	pages: {
		partners: { title: 'Business partners', icon: 'lucide:contact-round' },
		purchase_orders: { title: 'Purchase orders', icon: 'lucide:file-text' },
		facility_forms: { title: 'Financing requests', icon: 'lucide:file-signature' }
	}
});
