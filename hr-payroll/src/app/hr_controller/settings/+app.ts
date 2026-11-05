import { app } from '@norbital-ai/bolt';

export default app('hr_controller/settings', {
	title: 'app.settings.header_title',
	description: 'app.settings.header_description',
	icon: 'lucide:settings-2',
	banner: 'app-media/settings-banner.webp',
	pages: {
		lineage: { title: 'app.settings.lineage', icon: 'lucide:git-commit-vertical' },
		scheduled: { title: 'app.settings.scheduled', icon: 'lucide:calendar-clock' }
	}
});
