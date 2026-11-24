import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:sliders-horizontal',
	pages: {
		connections: { title: 'app.configuration.page_connections', icon: 'lucide:plug' },
		geofences: { title: 'app.configuration.page_geofences', icon: 'lucide:radar' },
		drivers: { title: 'app.configuration.page_drivers', icon: 'lucide:user-round' }
	}
});
