import { app } from '@norbital-ai/bolt';

export default app('construction_settings_workforce', {
	title: 'app.construction_settings_workforce.title',
	description: 'Manage workers, certifications, and job requirements.',
	icon: 'lucide:users',
	banner: 'app-media/construction_settings_workforce-banner.webp',
	pages: {
		workforce: { title: 'app.construction_settings_workforce.header_title', icon: 'lucide:users' }
	}
});
