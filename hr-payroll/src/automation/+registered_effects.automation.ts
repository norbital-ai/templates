import { automation } from '@norbital-ai/bolt';
import { queryRows } from '../lib/payroll_engine/reads.js';
import { applyRegisteredEffects } from '../lib/payroll_engine/registrations.js';

/**
 * The law's registered effects of records a person or automation without payroll authority may write (a leave or
 * claim entry an employee asks for, a profile the invitation automation makes), under `payroll_execution`: their
 * writer cannot read the law. An entry still waiting for approval raises nothing; its posting on
 * approval starts this again. The effects find what they already raised, so running it again changes nothing.
 */
export default automation({
	description:
		'Apply the law’s registered effects of leave entries, claim entries and new profiles; safe to run again.',
	input: {
		collection: { kind: 'text' },
		operation: { kind: 'text' },
		ids: { kind: 'text', many: true }
	},
	policies: ['payroll_execution'],
	run: function* ({ collection, operation, ids }, ctx) {
		if (
			(collection !== 'leave_catalog_entry' &&
				collection !== 'claim_catalog_entry' &&
				collection !== 'employee_profile') ||
			(operation !== 'create' && operation !== 'update')
		)
			return;
		const { [collection]: rows = [] } = yield* queryRows(ctx.query, {
			[collection]: { where: { id: { in: [...ids] } }, limit: 10000 }
		});
		const decided = rows.filter((row) => row.$approval == null);
		if (decided.length > 0)
			yield* applyRegisteredEffects(
				ctx,
				operation,
				collection,
				decided.map((after) => ({ after }))
			);
	}
});
