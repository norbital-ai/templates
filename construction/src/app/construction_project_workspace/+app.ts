import { app } from '@norbital-ai/bolt';

export default app('construction_project_workspace', {
	title: 'app.construction_project_workspace.title',
	description: 'Browse construction projects and open project records.',
	icon: 'lucide:layout-dashboard',
	banner: 'app-media/construction_project_workspace-banner.webp',
	pages: {
		projects: {
			title: 'app.construction_project_workspace.header_title',
			icon: 'lucide:building-2'
		}
	}
});
