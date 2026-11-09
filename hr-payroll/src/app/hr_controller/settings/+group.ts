import { group } from '@norbital-ai/bolt';

export default group('hr_controller/settings', {
	label: 'app.settings.header_title',
	description: 'app.settings.header_description',
	icon: 'lucide:settings-2',
	defaultChild: 'lineage'
});
