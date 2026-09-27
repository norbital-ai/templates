import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/adhoc', {
	title: 'Ad hoc',
	description:
		'One-off payments and deductions — bonus, back pay, separation pay, claw-backs — with the payroll capture that settled each',
	icon: 'lucide:hand-coins',
	banner: 'app-media/requests-banner.webp',
	pages: { adhoc: { title: 'Ad hoc', icon: 'lucide:hand-coins' } }
});
