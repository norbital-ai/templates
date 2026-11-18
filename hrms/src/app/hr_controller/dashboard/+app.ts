import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.dashboard.title',
	description: 'app.dashboard.description',
	icon: 'lucide:layout-dashboard',
	banner: 'app-media/entities-banner.webp',
	pages: {
		dashboard: { title: 'app.dashboard.title', icon: 'lucide:layout-dashboard' }
	}
});
