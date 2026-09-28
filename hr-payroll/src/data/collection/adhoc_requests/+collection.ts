import { collection } from '@norbital-ai/bolt';
import { boundToContract } from '../../../lib/employment-contract.js';
import { admitPayRequests, type PayRequestGuard } from '../../../lib/pay_request_rules.js';
import { dateKey } from '../../../lib/iso-day.js';
import { plain } from '../../../lib/wire.js';

/**
 * The day the payment is for is a column: an ad hoc request that does not say when cannot be written.
 *
 * Everything the catalogue decides — that the component takes requests, evidence, eligibility,
 * the entitlement ceiling — and the settlement lock live in `lib/pay_request_rules.ts`. What is
 * family-specific is below: the family this collection is, and which column dates a row.
 * `payslip_id` is the run's pin, never submitted; a captured row is not deleted (the delete
 * grant reads the pin).
 */
const GUARD: PayRequestGuard = {
	family: 'ADHOC',
	catalogue: 'adhoc_catalogue',
	requests: 'adhoc_requests',
	noun: 'ad hoc payment',
	sign: 1,
	eventDate: (candidate) => dateKey(candidate.event_date as string | null)
};

const c = collection('adhoc_requests', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'catalogue_id',
				'amount',
				'event_date',
				'reason',
				'evidence_file',
				'as_adjustment_entry',
				'late_wage',
				'pay_period'
			]
		}
	},
	update: {
		input: {
			columns: [
				'employment_id',
				'catalogue_id',
				'amount',
				'event_date',
				'reason',
				'evidence_file',
				'as_adjustment_entry',
				'late_wage',
				'pay_period'
			]
		}
	},
	delete: {}
});
export default c;

c.transform(async (inputs, ctx) => {
	const existing = ctx.existing.map((row) => plain(row) as Record<string, unknown> | undefined);
	await admitPayRequests(
		GUARD,
		ctx.db,
		inputs.map((input) => plain(input)),
		existing
	);
	return inputs.map((input, index) => boundToContract(input, existing[index]));
});
