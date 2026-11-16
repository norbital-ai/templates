import { app } from '@norbital-ai/bolt';
/** Financing, evidence, decisions and reporting. */
export default app({
	title: 'Treasury',
	description: 'Plan financing, record bank advices and close the month.',
	icon: 'lucide:landmark',
	banner: 'app-media/treasury.webp',
	pages: {
		dashboard: { title: 'Overview', icon: 'lucide:layout-dashboard' },
		drawdowns: { title: 'Financing', icon: 'lucide:hand-coins' },
		advices: { title: 'Bank advices', icon: 'lucide:file-scan' },
		alerts: { title: 'Attention', icon: 'lucide:bell' },
		costs: { title: 'Costs', icon: 'lucide:percent' },
		month_end: { title: 'Month-end', icon: 'lucide:calendar-check' }
	}
});
