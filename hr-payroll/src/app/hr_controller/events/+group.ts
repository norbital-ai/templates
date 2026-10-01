import { group } from '@norbital-ai/bolt';

export default group('hr_controller/events', {
	label: 'app.events.title',
	description: 'app.events.description',
	icon: 'lucide:inbox',
	defaultChild: 'work'
});
