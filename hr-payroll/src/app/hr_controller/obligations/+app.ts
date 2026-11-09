import { app } from '@norbital-ai/bolt';

export default app('hr_controller/obligations', {
	title: 'app.obligations.title',
	description: 'app.obligations.description',
	icon: 'lucide:clipboard-check',
	banner: 'app-media/entities-banner.webp',
	pages: {
		obligations: { title: 'app.obligations.title', icon: 'lucide:clipboard-check' }
	}
});
