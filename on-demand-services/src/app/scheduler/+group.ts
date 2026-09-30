import { group } from '@norbital-ai/bolt';

/** Everything the scheduling desk runs. `capabilities.apps: ['scheduler']` reaches every app under it. */
export default group('scheduler', {
	label: 'app.scheduler.title',
	description: 'app.scheduler.description',
	icon: 'lucide:calendar-range',
	defaultChild: 'schedule'
});
