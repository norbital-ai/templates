import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/claims', {
	title: 'Claims',
	description:
		'Expenses people paid for and are claiming back, with the payroll capture that settled each',
	icon: 'lucide:receipt-text',
	banner: 'app-media/requests-banner.webp',
	pages: { claims: { title: 'app.claims.title', icon: 'lucide:receipt-text' } }
});
