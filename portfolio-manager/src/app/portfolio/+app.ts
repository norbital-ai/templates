import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.portfolio.title',
	description: 'app.portfolio.description',
	icon: 'lucide:briefcase',
	banner: 'app-media/portfolio-banner.svg',
	pages: {
		dashboard: { title: 'app.portfolio.dashboard', icon: 'lucide:layout-dashboard' },
		reports: { title: 'app.portfolio.reports', icon: 'lucide:newspaper' },
		holdings: { title: 'app.portfolio.holdings', icon: 'lucide:trending-up' },
		subscribers: { title: 'app.portfolio.subscribers', icon: 'lucide:bell' },
		settings: { title: 'app.portfolio.settings', icon: 'lucide:settings' }
	}
});
