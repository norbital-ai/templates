import { collection } from '@norbital-ai/bolt';

/** Append-only: a warning is filed once; only its letter is attached afterwards, by the `warning_letter` run. */
export default collection('helper_warnings', {
	read: { fields: 'all' },
	create: { input: { columns: ['helper', 'visit', 'reason', 'issued_at', 'notes'] } },
	update: { input: { columns: ['letter'] } }
});
