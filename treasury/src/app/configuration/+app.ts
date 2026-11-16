import { app } from '@norbital-ai/bolt';
/** Reusable bank and financing configuration, separate from daily work. */
export default app({
	title: 'Configuration',
	description: 'Banks, facility terms and reporting exchange rates.',
	icon: 'lucide:settings',
	banner: 'app-media/configuration.webp',
	pages: {
		banks: { title: 'Banks', icon: 'lucide:landmark' },
		facilities: { title: 'Facilities', icon: 'lucide:gauge' },
		fx_rates: { title: 'Exchange rates', icon: 'lucide:arrow-left-right' }
	}
});
