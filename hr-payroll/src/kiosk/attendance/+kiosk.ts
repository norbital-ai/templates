import { kiosk } from '@norbital-ai/bolt';

// the device account signs in as a member of the Attendance Kiosk team; inside, it runs as the kiosk policy only
export default kiosk('attendance', {
	title: 'app.kiosk.title',
	description: 'app.kiosk.description',
	icon: 'lucide:scan-face',
	auth: 'members',
	policies: ['kiosk'],
	pages: { clock: { title: 'app.kiosk.title', icon: 'lucide:scan-face' } }
});
