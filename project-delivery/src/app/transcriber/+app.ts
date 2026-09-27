import { app } from '@norbital-ai/bolt';

export default app('transcriber', {
	title: 'app.transcriber.title',
	description: 'app.transcriber.header_description',
	icon: 'lucide:mic',
	pages: { transcriber: { title: 'app.transcriber.header_title', icon: 'lucide:mic' } }
});
