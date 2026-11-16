import { app } from '@norbital-ai/bolt';
/** One shared directory for supplier and customer relationships. */
export default app({
	title: 'Business partners',
	description: 'Suppliers and customers in one directory.',
	icon: 'lucide:contact-round',
	pages: { partners: { title: 'Business partners', icon: 'lucide:contact-round' } }
});
