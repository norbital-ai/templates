import { app } from '@norbital-ai/bolt';

export default app('hr_employee', {
	title: 'app.hr_employee.title',
	description: 'app.hr_employee.description',
	icon: 'lucide:user-round',
	banner: 'app-media/hr_employee-banner.webp',
	pages: { self_service: { title: 'app.hr_employee.title', icon: 'lucide:user-round' } }
});
