import { app } from '@norbital-ai/bolt';

export default app('helper', {
	title: 'app.helper.title',
	description: 'app.helper.description',
	icon: 'lucide:spray-can',
	banner: 'app-media/helper-banner.webp',
	pages: { today: { title: 'app.helper.tab_today', icon: 'lucide:sun' } }
});
