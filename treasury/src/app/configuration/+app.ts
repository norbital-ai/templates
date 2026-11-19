import { app } from '@norbital-ai/bolt';
/** Reusable bank and financing configuration, separate from daily work. */
export default app({
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:settings',
	banner: 'app-media/configuration.webp',
	pages: {
		banks: { title: 'app.configuration.banks', icon: 'lucide:landmark' },
		facilities: { title: 'app.configuration.facilities', icon: 'lucide:gauge' },
		fx_rates: { title: 'app.configuration.fx_rates', icon: 'lucide:arrow-left-right' }
	}
});
