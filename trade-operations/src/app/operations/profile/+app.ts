import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.profile.title',
	description: 'app.profile.description',
	icon: 'lucide:user-round-cog',
	banner: 'app-media/configuration-resin-banner.webp',
	pages: {
		profile: { title: 'app.profile.title', icon: 'lucide:id-card' }
	}
});
