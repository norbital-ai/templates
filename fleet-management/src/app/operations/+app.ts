import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.operations.title',
	description: 'app.operations.description',
	icon: 'lucide:navigation',
	pages: {
		live: { title: 'app.operations.page_live', icon: 'lucide:map-pinned' },
		vehicles: { title: 'app.operations.page_vehicles', icon: 'lucide:truck' },
		routes: { title: 'app.operations.page_routes', icon: 'lucide:route' },
		alerts: { title: 'app.operations.page_alerts', icon: 'lucide:siren' }
	}
});
