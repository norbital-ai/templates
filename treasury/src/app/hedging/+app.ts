import { app } from '@norbital-ai/bolt';
/** FX hedges: where they stand at today's rate, their documents and fixings, and the bankers' proposals. */
export default app({
	title: 'app.hedging.title',
	description: 'app.hedging.description',
	icon: 'lucide:arrow-left-right',
	pages: {
		overview: { title: 'app.hedging.overview', icon: 'lucide:layout-dashboard' },
		deals: { title: 'app.hedging.deals', icon: 'lucide:layers' },
		fixings: { title: 'app.hedging.fixings', icon: 'lucide:calendar-clock' },
		planning: { title: 'app.hedging.planning', icon: 'lucide:lightbulb' }
	}
});
