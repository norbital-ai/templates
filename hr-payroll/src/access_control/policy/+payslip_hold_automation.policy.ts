import { policy } from '@norbital-ai/bolt';
import { AUTOMATION_LIMITS } from './grants.js';

/** The record-driven taps' one payslip move: a draft slip a `hold` validation stopped goes ON_HOLD, nothing else. */
export default policy({
	description:
		'Puts a draft payslip on hold when a jurisdiction validation of its run holds it; it cannot release or pay a slip.',
	grants: {
		payslip: {
			read: true,
			update: {
				columns: { payslip: ['status'] },
				check: function* (changes, ctx) {
					return changes.every(
						({ before, set }) => before.status === 'DRAFT' && set.status === 'ON_HOLD'
					)
						? ctx.allow()
						: ctx.deny('This automation only puts a draft payslip on hold.');
				}
			},
			moves: { status: ['DRAFT->ON_HOLD'] }
		}
	},
	limits: AUTOMATION_LIMITS
});
