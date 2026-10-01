import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/adhoc', {
	title: 'app.adhoc.title',
	description: 'app.adhoc.description',
	icon: 'lucide:hand-coins',
	banner: 'app-media/requests-banner.webp',
	pages: { adhoc: { title: 'app.adhoc.title', icon: 'lucide:hand-coins' } }
});
