import { app } from '@norbital-ai/bolt';

export default app('construction_project_workspace', {
	title: 'app.construction_project_workspace.title',
	description: 'app.construction_project_workspace.description',
	icon: 'lucide:building-2',
	banner: 'app-media/construction_project_workspace-banner.webp',
	pages: {
		projects: {
			title: 'app.construction_project_workspace.title',
			icon: 'lucide:building-2'
		}
	}
});
