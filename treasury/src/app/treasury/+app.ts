import { app } from '@norbital-ai/bolt';
/** Financing, evidence, decisions and reporting. */
export default app({
	title: 'app.treasury.title',
	description: 'app.treasury.description',
	icon: 'lucide:landmark',
	banner: 'app-media/treasury.webp',
	pages: {
		dashboard: { title: 'app.treasury.dashboard', icon: 'lucide:layout-dashboard' },
		drawdowns: { title: 'app.treasury.drawdowns', icon: 'lucide:hand-coins' },
		advices: { title: 'app.treasury.advices', icon: 'lucide:file-scan' },
		alerts: { title: 'app.treasury.alerts', icon: 'lucide:bell' },
		costs: { title: 'app.treasury.costs', icon: 'lucide:percent' },
		month_end: { title: 'app.treasury.month_end', icon: 'lucide:calendar-check' }
	}
});
