import { app } from '@norbital-ai/bolt';

export default app('helper', {
	title: 'app.helper.title',
	description: 'app.helper.description',
	icon: 'lucide:spray-can',
	pages: { today: { title: 'app.helper.tab_today', icon: 'lucide:sun' } }
});
