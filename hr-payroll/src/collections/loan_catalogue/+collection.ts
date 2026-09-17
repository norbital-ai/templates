import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { admitCatalogueRow } from '../../lib/catalogue_rules.js';
import { versionsById } from '../../lib/settings_seal.js';

const columns = {
	settings_id: true,
	code: true,
	name: true,
	destination: true,
	direction: true,
	bands: true,
	loan_type: true,
	minimum_repayment: true,
	eligibility: true,
	evidence: true
} as const;

/**
 * A loan is recovered: its line takes money from the person, never gives it. A row that landed as
 * `PAY · ADD` once paid every instalment *to* the borrower on top of their wage — the seed
 * converter's default — so the landing is checked where the row is written.
 */
const assertRecovers = (row: {
	readonly code?: unknown;
	readonly destination?: unknown;
	readonly direction?: unknown;
}): void => {
	const lands = row.destination === 'PAY' || row.destination === 'NET';
	if (!lands || row.direction !== 'SUBTRACT')
		refuse(
			`Loan ${String(row.code ?? '')} must be recovered from pay or net (destination PAY or NET, direction SUBTRACT); it cannot be paid out.`
		);
};

/**
 * Loan catalogue rows belong to a settings version and are sealed with it: a row of a sealed
 * version refuses create and update here, and delete through the grant (`settingsCatalogueGrants`).
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.map(
			versionsById(db, [
				...inputs.map((input) => input.settings_id),
				...existing.map((row) => row?.settings_id)
			]),
			(versions) =>
				inputs.map((input, index) => {
					const admitted = admitCatalogueRow(versions, input, existing[index], 'Loan');
					assertRecovers({ ...existing[index], ...admitted });
					return admitted;
				})
		)
});
