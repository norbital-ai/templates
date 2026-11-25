import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.scheduling.title',
	description: 'app.scheduling.description',
	icon: 'lucide:calendar-range',
	banner: 'app-media/scheduling-banner.webp',
	pages: {
		schedule: { title: 'app.scheduling.tab_schedule', icon: 'lucide:kanban' },
		bookings: { title: 'app.scheduling.tab_bookings', icon: 'lucide:calendar-plus' },
		dispatch: { title: 'app.scheduling.tab_dispatch', icon: 'lucide:siren' },
		live: { title: 'app.scheduling.tab_live', icon: 'lucide:map-pinned' },
		customers: { title: 'app.scheduling.tab_customers', icon: 'lucide:contact' },
		providers: { title: 'app.scheduling.tab_providers', icon: 'lucide:users' }
	}
});
