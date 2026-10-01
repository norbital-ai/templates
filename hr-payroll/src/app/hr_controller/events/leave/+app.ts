import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/leave', {
	title: 'app.leave.title',
	description: 'app.leave.description',
	icon: 'lucide:calendar-check-2',
	banner: 'app-media/leave-banner.webp',
	pages: { leave: { title: 'app.leave.title', icon: 'lucide:calendar-check-2' } }
});
