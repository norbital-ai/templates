import { app } from '@norbital-ai/bolt';

export default app('kiosk', {
	title: 'app.kiosk.title',
	description: 'app.kiosk.description',
	icon: 'lucide:scan-face',
	// face check-in: no camera, no kiosk
	requires: ['camera'],
	pages: { kiosk: { title: 'app.kiosk.title', icon: 'lucide:scan-face', portal: true } }
});
