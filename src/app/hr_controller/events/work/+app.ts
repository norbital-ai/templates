import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/work', {
	title: 'app.work.title',
	description: 'app.work.description',
	icon: 'lucide:calendar-clock',
	banner: 'app-media/scheduling-banner.webp',
	pages: { work: { title: 'app.work.title', icon: 'lucide:calendar-clock' } }
});
