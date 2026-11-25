import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:settings',
	banner: 'app-media/configuration-banner.webp',
	pages: {
		services: { title: 'app.configuration.tab_services', icon: 'lucide:briefcase' },
		settings: { title: 'app.configuration.tab_settings', icon: 'lucide:sliders-horizontal' },
		connections: { title: 'app.configuration.tab_connections', icon: 'lucide:plug' }
	}
});
