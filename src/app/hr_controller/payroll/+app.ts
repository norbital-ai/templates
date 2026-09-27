import { app } from '@norbital-ai/bolt';

export default app('hr_controller/payroll', {
	title: 'Payroll',
	description: 'Create payroll runs, review payslips, export payments, and audit calculations',
	icon: 'lucide:badge-dollar-sign',
	banner: 'app-media/payroll-banner.webp',
	pages: { payroll: { title: 'Payroll', icon: 'lucide:badge-dollar-sign' } }
});
