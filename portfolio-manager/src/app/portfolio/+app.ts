import { app } from '@norbital-ai/bolt';

export default app({
	title: 'Portfolio',
	description:
		'The book: every holding with its research, and the daily report computed from the book and the market.',
	icon: 'lucide:briefcase',
	pages: {
		dashboard: { title: 'Dashboard', icon: 'lucide:layout-dashboard' },
		reports: { title: 'Reports', icon: 'lucide:newspaper' },
		holdings: { title: 'Holdings', icon: 'lucide:trending-up' },
		settings: { title: 'Settings', icon: 'lucide:settings' }
	}
});
