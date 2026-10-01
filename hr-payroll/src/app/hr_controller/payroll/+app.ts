import { app } from '@norbital-ai/bolt';

export default app('hr_controller/payroll', {
	title: 'app.payroll.title',
	description: 'app.payroll.description',
	icon: 'lucide:badge-dollar-sign',
	banner: 'app-media/payroll-banner.webp',
	pages: { payroll: { title: 'app.payroll.title', icon: 'lucide:badge-dollar-sign' } }
});
