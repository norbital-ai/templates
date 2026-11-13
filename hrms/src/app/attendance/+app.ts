import { app } from '@norbital-ai/bolt';

// the device account signs in as a member of the Attendance Kiosk team; inside, it runs as the kiosk policy only
export default app({
	title: 'app.kiosk.title',
	description: 'app.kiosk.description',
	icon: 'lucide:scan-face',
	shell: 'kiosk',
	audience: 'members',
	policies: ['kiosk'],
	pages: { clock: { title: 'app.kiosk.title', icon: 'lucide:scan-face' } }
});
