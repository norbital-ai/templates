import { app } from '@norbital-ai/bolt';
/** One relationship directory and one work queue, led by the calendar. */
export default app({
	banner: 'app-media/crm.webp',
	title: 'app.crm.title',
	description: 'app.crm.description',
	icon: 'lucide:contact-round',
	pages: {
		dashboard: { title: 'dashboard.title', icon: 'lucide:calendar-days' },
		companies: { title: 'companies.title', icon: 'lucide:building-2' },
		tasks: { title: 'tasks.title', icon: 'lucide:list-checks' }
	}
});
