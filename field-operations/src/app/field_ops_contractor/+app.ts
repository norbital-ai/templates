import { app } from '@norbital-ai/bolt';

export default app('field_ops_contractor', {
	title: 'app.field_ops_contractor.title',
	description: 'app.field_ops_contractor.header_description',
	icon: 'lucide:hard-hat',
	banner: 'app-media/field_ops_contractor-banner.webp',
	pages: { jobs: { title: 'app.field_ops_contractor.dispatched_jobs', icon: 'lucide:hard-hat' } }
});
