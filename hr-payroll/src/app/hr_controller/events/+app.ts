import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events', {
	title: 'app.events.title',
	description: 'app.events.description',
	icon: 'lucide:inbox',
	banner: 'app-media/scheduling-banner.webp',
	pages: {
		work: { title: 'app.work.title', icon: 'lucide:calendar-clock' },
		leave: { title: 'app.leave.title', icon: 'lucide:calendar-check-2' },
		claims: { title: 'app.claims.title', icon: 'lucide:receipt-text' },
		adhoc: { title: 'app.adhoc.title', icon: 'lucide:hand-coins' },
		loans: { title: 'app.loans.title', icon: 'lucide:landmark' }
	}
});
