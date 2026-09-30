import { app } from '@norbital-ai/bolt';

export default app('scheduler/customers', {
	title: 'app.customers.title',
	description: 'app.customers.description',
	icon: 'lucide:house',
	pages: { profiles: { title: 'app.customers.tab_profiles', icon: 'lucide:contact' } }
});
