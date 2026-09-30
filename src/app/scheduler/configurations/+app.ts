import { app } from '@norbital-ai/bolt';

export default app('scheduler/configurations', {
	title: 'app.configurations.title',
	description: 'app.configurations.description',
	icon: 'lucide:settings',
	banner: 'app-media/scheduler_configurations-banner.webp',
	pages: {
		dispatch: { title: 'app.configurations.tab_dispatch', icon: 'lucide:sliders-horizontal' },
		services: { title: 'app.configurations.tab_services', icon: 'lucide:sparkles' }
	}
});
