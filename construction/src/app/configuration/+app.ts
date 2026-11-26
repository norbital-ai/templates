import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:settings-2',
	pages: {
		item_matrix: { title: 'item_matrix.title', icon: 'lucide:table-2' },
		sop_rules: { title: 'sop_rules.tab_title', icon: 'lucide:shield-check' },
		bim_settings: { title: 'bim_settings.title', icon: 'lucide:sliders-horizontal' },
		connections: { title: 'connections.title', icon: 'lucide:plug' }
	}
});
