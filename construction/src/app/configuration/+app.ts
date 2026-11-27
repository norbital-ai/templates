import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:settings-2',
	pages: {
		item_matrix: { title: 'item_matrix.title', icon: 'lucide:table-2' },
		bim_compliance: { title: 'bim_compliance.nav_title', icon: 'lucide:shield-check' },
		report_templates: { title: 'reports.nav_title', icon: 'lucide:file-spreadsheet' }
	}
});
