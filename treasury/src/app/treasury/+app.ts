import { app } from '@norbital-ai/bolt';
/** Treasury: bank facilities, lines, costs and month-ends. */
export default app({
	title: 'Treasury',
	description: 'Bank facilities, lines, limits, costs and month-ends.',
	icon: 'lucide:landmark',
	pages: {
		dashboard: { title: 'Dashboard', icon: 'lucide:layout-dashboard' },
		drawdowns: { title: 'Drawdowns', icon: 'lucide:hand-coins' },
		alerts: { title: 'Alerts', icon: 'lucide:bell' },
		advices: { title: 'Bank advices', icon: 'lucide:file-scan' },
		limits: { title: 'Limits & terms', icon: 'lucide:gauge' },
		banks: { title: 'Banks', icon: 'lucide:building-2' },
		suppliers: { title: 'Suppliers', icon: 'lucide:truck' },
		costs: { title: 'Costs', icon: 'lucide:percent' },
		charges: { title: 'Charges', icon: 'lucide:receipt' },
		month_end: { title: 'Month-end', icon: 'lucide:calendar-check' }
	}
});
