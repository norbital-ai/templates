import { Effect } from 'effect';
import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { boundToContract } from '../../lib/employment-contract.js';
import { admitPayRequests, type PayRequestGuard } from '../../lib/pay_request_rules.js';
import { canonicalDays, dateKey } from '../../lib/iso-day.js';

const columns = {
	employment_id: true,
	catalogue_id: true,
	amount: true,
	incurred_on: true,
	description: true,
	evidence_file: true,
	as_adjustment_entry: true,
	pay_period: true
} as const;

/**
 * The day the expense was incurred is a column: a claim that does not say when cannot be written.
 *
 * Everything the catalogue decides — that the component takes requests, evidence, the entitlement
 * ceiling — the reads that answer them, and the settlement lock all live in
 * `src/lib/pay_request_rules.ts`. What is family-specific is exactly what is below: the family
 * this collection is, and which of its columns dates a row. `payslip_id` is the run's pin, never
 * submitted; a captured claim is not deleted (the delete grant reads the pin).
 */
const GUARD: PayRequestGuard = {
	family: 'CLAIM',
	catalogue: 'claim_catalogue',
	requests: 'claim_requests',
	noun: 'claim',
	sign: 1,
	eventDate: (candidate) => dateKey(candidate.incurred_on as string | null)
};

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.map(admitPayRequests(GUARD, db, inputs, existing), () =>
			inputs.map((input, index) =>
				boundToContract(canonicalDays(input, ['incurred_on']), existing[index])
			)
		)
});
