import { app } from '@norbital-ai/bolt';

export default app('kiosk', {
	title: 'app.kiosk.title',
	description: 'app.kiosk.description',
	icon: 'lucide:scan-face',
	pages: { kiosk: { title: 'app.kiosk.title', icon: 'lucide:scan-face', site: true } }
});
