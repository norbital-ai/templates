import { app } from '@norbital-ai/bolt';
export default app('hr_controller/payroll', {
	title: 'app.payroll.runs_title',
	description: 'app.payroll.runs_description',
	icon: 'lucide:receipt',
	banner: 'app-media/entities-banner.webp',
	pages: {
		payroll: { title: 'app.payroll.runs_title', icon: 'lucide:receipt' },
		compliance: { title: 'app.compliance.title', icon: 'lucide:clipboard-check' }
	}
});
