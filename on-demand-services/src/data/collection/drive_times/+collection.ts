import { collection } from '@norbital-ai/bolt';

/** Written only by the `check_drives` run. */
export default collection('drive_times', {
	read: { fields: 'all' },
	create: { input: { columns: ['leg', 'minutes'] } }
});
