import { app } from '@norbital-ai/bolt';
export default app({
	banner: 'app-media/configuration.webp',
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:settings-2',
	pages: {
		rules: { title: 'configuration.rules', icon: 'lucide:filter' },
		connections: { title: 'connections.title', icon: 'lucide:plug' },
		products: { title: 'products.title', icon: 'lucide:package' },
		templates: { title: 'crm.section.templates', icon: 'lucide:files' },
		sequences: { title: 'sequences.title', icon: 'lucide:list-ordered' }
	}
});
