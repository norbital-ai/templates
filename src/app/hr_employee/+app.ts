import { app } from '@norbital-ai/bolt';

export default app('hr_employee', {
	title: 'Employee Self-Service',
	description: 'View your schedule, leave, pay requests, loans, payslips, and profile',
	icon: 'lucide:user-round',
	banner: 'app-media/hr_employee-banner.webp',
	pages: { self_service: { title: 'Employee Self-Service', icon: 'lucide:user-round' } }
});
