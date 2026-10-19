import { app } from '@norbital-ai/bolt';
export default app('trade_configuration', {
	title: 'app.trade_configuration.title',
	description: 'app.trade_configuration.description',
	icon: 'lucide:settings',
	banner: 'app-media/configuration-resin-banner.webp',
	pages: {
		templates: { title: 'models.document_templates.label', icon: 'lucide:file-text' },
		settings: { title: 'models.commercial_settings.label', icon: 'lucide:settings' },
		pricing_floors: { title: 'models.pricing_floors.label', icon: 'lucide:chart-no-axes-combined' },
		rules: { title: 'models.commission_rules.label', icon: 'lucide:percent' }
	}
});
