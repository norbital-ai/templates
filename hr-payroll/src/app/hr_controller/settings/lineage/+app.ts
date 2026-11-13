import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.settings.lineage',
	description: 'app.settings.header_description',
	icon: 'lucide:git-commit-vertical',
	banner: 'app-media/settings-banner.webp',
	pages: {
		lineage: { title: 'app.settings.lineage', icon: 'lucide:git-commit-vertical' }
	}
});
