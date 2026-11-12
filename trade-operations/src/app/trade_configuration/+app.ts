import { app } from '@norbital-ai/bolt';
export default app({
	title: 'app.trade_configuration.title',
	description: 'app.trade_configuration.description',
	icon: 'lucide:settings',
	banner: 'app-media/configuration-resin-banner.webp',
	pages: {
		templates: { title: 'section.documents', icon: 'lucide:file-text' },
		pricing_floors: { title: 'section.pricing', icon: 'lucide:chart-no-axes-combined' }
	}
});
