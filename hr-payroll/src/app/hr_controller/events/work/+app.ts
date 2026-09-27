import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/work', {
	title: 'Work',
	description:
		'Plan the monthly roster on a calendar, publish it against the statutory rules, and manage the shifts a day is worked on and the patterns a week is shaped by',
	icon: 'lucide:calendar-clock',
	banner: 'app-media/scheduling-banner.webp',
	pages: { work: { title: 'Work', icon: 'lucide:calendar-clock' } }
});
