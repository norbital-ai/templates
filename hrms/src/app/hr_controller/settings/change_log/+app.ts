import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.settings.change_log',
	description: 'app.settings.change_log_description',
	icon: 'lucide:history',
	pages: {
		scheduled: { title: 'app.settings.scheduled', icon: 'lucide:calendar-clock' }
	}
});
