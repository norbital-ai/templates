import { automation } from '@norbital-ai/bolt';
import { queryRows } from '../lib/payroll_engine/reads.js';
import { applyRegisteredEffects } from '../lib/payroll_engine/registrations.js';

const COLLECTIONS = ['leave_catalog_entry', 'claim_catalog_entry', 'employee_profile'] as const;
type Collection = (typeof COLLECTIONS)[number];
const isCollection = (value: string): value is Collection =>
	COLLECTIONS.some((collection) => collection === value);

/**
 * The law's registered effects of records a person without payroll authority may write (a leave or claim entry an
 * employee asks for, a profile the invitation automation makes). It listens to their saves and runs under
 * `payroll_execution`: their writer cannot read the law. An entry still waiting for approval raises nothing; its
 * approval is the write that starts this. The effects find what they already raised, so running it again changes
 * nothing.
 */
export default automation({
	description:
		'Apply the law’s registered effects of leave entries, claim entries and new profiles; safe to run again.',
	on: [
		{ model: 'leave_catalog_entry', verbs: ['create', 'update'] },
		{ model: 'claim_catalog_entry', verbs: ['create', 'update'] },
		{ model: 'employee_profile', verbs: ['create'] }
	],
	policies: ['payroll_execution'],
	run: function* (_, ctx) {
		const trigger = ctx.trigger;
		if (trigger.kind !== 'system' || trigger.cause !== 'event') return;
		const { model: collection, verb: operation, records: ids } = trigger;
		if (!isCollection(collection) || (operation !== 'create' && operation !== 'update')) return;
		if (ids.length === 0) return;
		const { [collection]: rows = [] } = yield* queryRows(ctx.query, {
			[collection]: { where: { id: { in: [...ids].map(String) } }, limit: 10000 }
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
