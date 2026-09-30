import { collection } from '@norbital-ai/bolt';

/** Written only by the `publish_openings` run. */
export default collection('openings', {
	read: { fields: 'all' },
	create: { input: { columns: ['service', 'day', 'starts'] } },
	update: { input: { columns: ['starts'] } },
	delete: {}
});
