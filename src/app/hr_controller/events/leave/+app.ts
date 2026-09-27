import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/leave', {
	title: 'Leave',
	description: 'Manual leave activities and their payroll settlement',
	icon: 'lucide:calendar-check-2',
	banner: 'app-media/leave-banner.webp',
	pages: { leave: { title: 'Leave', icon: 'lucide:calendar-check-2' } }
});
