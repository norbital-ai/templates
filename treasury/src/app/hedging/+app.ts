import { app } from '@norbital-ai/bolt';
/** FX hedges: where they stand at today's rate, their documents and fixings, and the bankers' proposals. */
export default app({
	title: 'Hedging',
	description: 'FX hedges, their fixings and documents, and proposals to weigh.',
	icon: 'lucide:arrow-left-right',
	pages: {
		overview: { title: 'Overview', icon: 'lucide:layout-dashboard' },
		deals: { title: 'Structures', icon: 'lucide:layers' },
		fixings: { title: 'Fixings', icon: 'lucide:calendar-clock' },
		planning: { title: 'Planning', icon: 'lucide:lightbulb' }
	}
});
