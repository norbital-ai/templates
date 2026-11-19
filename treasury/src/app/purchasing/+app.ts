import { app } from '@norbital-ai/bolt';
/** Purchasing: purchase orders raised on suppliers with their invoices, and their financing requests. */
export default app({
	title: 'app.purchasing.title',
	description: 'app.purchasing.description',
	icon: 'lucide:file-text',
	banner: 'app-media/purchasing.webp',
	pages: {
		partners: { title: 'app.purchasing.partners', icon: 'lucide:contact-round' },
		purchase_orders: { title: 'app.purchasing.purchase_orders', icon: 'lucide:file-text' },
		facility_forms: { title: 'app.purchasing.facility_forms', icon: 'lucide:file-signature' }
	}
});
