import { app } from '@norbital-ai/bolt';

export default app('field_ops_controller', {
	title: 'app.field_ops_controller.title',
	description: 'Schedule site jobs and dispatch contractors',
	icon: 'lucide:building-2',
	banner: 'app-media/field_ops_controller-banner.webp',
	pages: {
		dispatch: { title: 'app.field_ops_controller.tab_dispatch', icon: 'lucide:kanban' },
		sites: { title: 'app.field_ops_controller.tab_sites', icon: 'lucide:map-pinned' }
	}
});
