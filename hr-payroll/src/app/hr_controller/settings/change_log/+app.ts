import { app } from '@norbital-ai/bolt';

export default app('hr_controller/settings/change_log', {
	title: 'app.settings.change_log',
	description: 'app.settings.change_log_description',
	icon: 'lucide:history',
	pages: {
		scheduled: { title: 'app.settings.scheduled', icon: 'lucide:calendar-clock' },
		change_log: { title: 'app.settings.change_log', icon: 'lucide:history' }
	}
});
