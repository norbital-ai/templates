import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.operations.title',
	description: 'app.operations.description',
	icon: 'lucide:hard-hat',
	banner: 'app-media/construction_project_workspace-banner.webp',
	pages: {
		projects: { title: 'app.operations.page_projects', icon: 'lucide:building-2' },
		messages: { title: 'app.operations.page_messages', icon: 'lucide:message-square-text' }
	}
});
