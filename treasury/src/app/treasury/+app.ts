import { app } from '@norbital-ai/bolt';
/** Treasury: bank facilities, lines, costs and month-ends. */
export default app({
	title: 'Treasury',
	description: 'Bank facilities, lines, limits, costs and month-ends.',
	icon: 'lucide:landmark',
	pages: {
		dashboard: { title: 'Dashboard', icon: 'lucide:layout-dashboard', section: 'app.nav.daily' },
		drawdowns: { title: 'Drawdowns', icon: 'lucide:hand-coins', section: 'app.nav.daily' },
		advices: { title: 'Bank advices', icon: 'lucide:file-scan', section: 'app.nav.daily' },
		alerts: { title: 'Alerts', icon: 'lucide:bell', section: 'app.nav.daily' },
		costs: { title: 'Costs', icon: 'lucide:percent', section: 'app.nav.reports' },
		charges: { title: 'Charges', icon: 'lucide:receipt', section: 'app.nav.reports' },
		month_end: { title: 'Month-end', icon: 'lucide:calendar-check', section: 'app.nav.reports' },
		limits: { title: 'Limits & terms', icon: 'lucide:gauge', section: 'app.nav.setup' },
		banks: { title: 'Banks', icon: 'lucide:building-2', section: 'app.nav.setup' },
		suppliers: { title: 'Suppliers', icon: 'lucide:truck', section: 'app.nav.setup' }
	}
});
