import { app } from '@norbital-ai/bolt';

export default app('helper', {
	title: 'app.helper.title',
	description: 'app.helper.description',
	icon: 'lucide:spray-can',
	banner: 'app-media/helper-banner.webp',
	// position shared in the background for the ETA check, and assignments pushed to the phone
	requires: ['location:background', 'notifications'],
	pages: { today: { title: 'app.helper.tab_today', icon: 'lucide:sun' } }
});
