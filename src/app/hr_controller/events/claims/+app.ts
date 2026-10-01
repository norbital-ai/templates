import { app } from '@norbital-ai/bolt';

export default app('hr_controller/events/claims', {
	title: 'app.claims.title',
	description: 'app.claims.description',
	icon: 'lucide:receipt-text',
	banner: 'app-media/requests-banner.webp',
	pages: { claims: { title: 'app.claims.title', icon: 'lucide:receipt-text' } }
});
