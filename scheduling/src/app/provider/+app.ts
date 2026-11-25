import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.provider.title',
	description: 'app.provider.description',
	icon: 'lucide:clipboard-check',
	banner: 'app-media/provider-banner.webp',
	requires: ['location:background', 'notifications'],
	pages: {
		today: { title: 'app.provider.tab_today', icon: 'lucide:sun' }
	}
});
