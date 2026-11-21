import { app } from '@norbital-ai/bolt';

export default app({
	title: 'app.configuration.title',
	description: 'app.configuration.description',
	icon: 'lucide:settings-2',
	pages: {
		connections: { title: 'connections.title', icon: 'lucide:plug' },
		contacts: { title: 'contacts.title', icon: 'lucide:contact-round' }
	}
});
