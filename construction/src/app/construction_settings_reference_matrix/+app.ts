import { app } from '@norbital-ai/bolt';

export default app('construction_settings_reference_matrix', {
	title: 'app.construction_settings_reference_matrix.title',
	description: 'Maintain the BIM reference matrix.',
	icon: 'lucide:grid-3x3',
	banner: 'app-media/construction_settings_reference_matrix-banner.webp',
	pages: {
		matrix: {
			title: 'app.construction_settings_reference_matrix.header_title',
			icon: 'lucide:table-properties'
		}
	}
});
