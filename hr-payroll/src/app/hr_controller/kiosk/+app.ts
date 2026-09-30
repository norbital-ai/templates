import { app } from '@norbital-ai/bolt';

export default app('hr_controller/kiosk', {
	title: 'Attendance Kiosk',
	description: 'Face-recognition time clock for the shop floor.',
	icon: 'lucide:scan-face',
	pages: { kiosk: { title: 'Attendance Kiosk', icon: 'lucide:scan-face', site: true } }
});
