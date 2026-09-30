import { collection } from '@norbital-ai/bolt';
import { boundToContract } from '../../../lib/employment-contract.js';
import { admitPayRequests, type PayRequestGuard } from '../../../lib/pay_request_rules.js';
import { dateKey } from '../../../lib/iso-day.js';
import { plain } from '../../../lib/wire.js';

/**
 * The day the expense was incurred is a column: a claim that does not say when cannot be written.
 *
 * Everything the catalogue decides — that the component takes requests, evidence, eligibility,
 * the entitlement ceiling — and the settlement lock live in `lib/pay_request_rules.ts`. What is
 * family-specific is below: the family this collection is, and which column dates a row.
 * `payslip_id` is the run's pin, never submitted; a captured row is not deleted (the delete
 * grant reads the pin).
 */
const GUARD: PayRequestGuard = {
	family: 'CLAIM',
	catalogue: 'claim_catalogue',
	requests: 'claim_requests',
	noun: 'claim',
	sign: 1,
	eventDate: (candidate) => dateKey((candidate.due_on ?? candidate.incurred_on) as string | null)
};

const c = collection('claim_requests', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'catalogue_id',
				'amount',
				'incurred_on',
				'description',
				'evidence_file',
				'due_on',
				'facts',
				'as_adjustment_entry',
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
				'incurred_on',
				'description',
				'evidence_file',
				'due_on',
				'facts',
				'as_adjustment_entry',
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
