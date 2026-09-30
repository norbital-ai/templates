import { app } from '@norbital-ai/bolt';

export default app('scheduler/schedule', {
	title: 'app.schedule.title',
	description: 'app.schedule.description',
	icon: 'lucide:calendar-clock',
	banner: 'app-media/scheduler_schedule-banner.webp',
	pages: {
		board: { title: 'app.schedule.tab_board', icon: 'lucide:kanban' },
		warnings: { title: 'app.schedule.tab_warnings', icon: 'lucide:siren' },
		live: { title: 'app.schedule.tab_live', icon: 'lucide:map-pinned' },
		bookings: { title: 'app.schedule.tab_bookings', icon: 'lucide:calendar-plus' }
	}
});
