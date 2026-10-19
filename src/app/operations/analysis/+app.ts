import { app } from '@norbital-ai/bolt';
export default app('operations/analysis', {
	title: 'component.analysis',
	description: 'app.analysis.description',
	icon: 'lucide:chart-column',
	banner: 'app-media/analysis-resin-banner.webp',
	pages: { reports: { title: 'component.analysis', icon: 'lucide:chart-column' } }
});
