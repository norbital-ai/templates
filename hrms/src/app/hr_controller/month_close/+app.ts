import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.month_close.title',
	description: 'app.month_close.description',
	icon: 'lucide:list-checks',
	banner: 'app-media/entities-banner.webp',
	pages: {
		month_close: { title: 'app.month_close.title', icon: 'lucide:list-checks' }
	}
});
