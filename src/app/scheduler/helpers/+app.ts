import { app } from '@norbital-ai/bolt';

export default app('scheduler/helpers', {
	title: 'app.helpers.title',
	description: 'app.helpers.description',
	icon: 'lucide:users',
	banner: 'app-media/scheduler_helpers-banner.webp',
	pages: { profiles: { title: 'app.helpers.tab_profiles', icon: 'lucide:id-card' } }
});
