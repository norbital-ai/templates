import { group } from '@norbital-ai/bolt';
/** Everything the scheduling desk runs. `capabilities.apps: ['scheduler']` reaches every app under it. */
export default group({
	title: 'app.scheduler.title',
	description: 'app.scheduler.description',
	icon: 'lucide:calendar-range',
	default_child: 'schedule'
});
